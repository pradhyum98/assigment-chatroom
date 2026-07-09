import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Message } from '../models/Message';
import { ChatRoom } from '../models/ChatRoom';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

// Maximum time window (in ms) within which a sender may edit their own message
const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verify the room exists and that the requesting user is a participant.
 * Returns the ChatRoom document on success.
 */
const requireRoomParticipant = async (roomId: string, userId: string) => {
  const room = await ChatRoom.findOne({ roomId });
  if (!room) throw new AppError('Room not found.', 404);

  const isParticipant = room.participants.some(
    (pId) => pId.toString() === userId
  );
  if (!isParticipant) throw new AppError('You are not authorized to access this room.', 403);

  return room;
};

// ─── GET /api/messages/:roomId ─────────────────────────────────────────────────

export const getMessagesByRoom = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;

    await requireRoomParticipant(roomId, user._id);

    const limit  = Math.min(parseInt(req.query['limit'] as string) || 50, 100);
    const before = req.query['before'] as string | undefined;
    const sinceId = req.query['sinceId'] as string | undefined;

    const query: Record<string, unknown> = {
      roomId,
      // Exclude messages deleted for everyone
      $or: [{ deletedForEveryone: false }, { deletedForEveryone: { $exists: false } }],
    };

    if (before) {
      const beforeDate = new Date(before);
      if (isNaN(beforeDate.getTime())) {
        throw new AppError('The "before" timestamp provided is invalid.', 400);
      }
      query['timestamp'] = { $lt: beforeDate };
    }

    if (sinceId) {
      if (!mongoose.Types.ObjectId.isValid(sinceId)) {
        throw new AppError('The "sinceId" provided is invalid.', 400);
      }
      query['_id'] = { $gt: new mongoose.Types.ObjectId(sinceId) };
    }

    const messages = await Message.find(query)
      .populate('replyTo', 'messageId senderId senderName content type timestamp')
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    // Reverse to maintain chronological order for the client
    const sortedMessages = messages.reverse();

    res.status(200).json({
      success: true,
      message: 'Chat history retrieved.',
      data: {
        messages: sortedMessages,
        pagination: {
          limit,
          count: sortedMessages.length,
          hasMore: sortedMessages.length === limit,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── PATCH /api/messages/:messageId ───────────────────────────────────────────

const editMessageSchema = z.object({
  content: z.string().min(1, 'Content cannot be empty').max(2000, 'Content too long'),
});

export const editMessage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { messageId } = req.params;

    const { success, data, error } = editMessageSchema.safeParse(req.body);
    if (!success) throw new AppError(error.errors[0].message, 400);

    const msg = await Message.findOne({ messageId });
    if (!msg) throw new AppError('Message not found.', 404);

    const { result } = await (await import('../services/MessageService')).MessageService.editMessage(
      {
        messageId,
        senderId: user._id.toString(),
        content: data.content,
        mutationId: (await import('crypto')).randomUUID() // In real world client should pass this
      },
      { email: user.email }
    );

    res.status(200).json({
      success: true,
      message: 'Message edited.',
      data: { message: result },
    });
  } catch (error) {
    next(error);
  }
};

// ─── DELETE /api/messages/:messageId ──────────────────────────────────────────

const deleteMessageSchema = z.object({
  deleteForEveryone: z.boolean().optional().default(false),
});

export const deleteMessage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { messageId } = req.params;
    const { data } = deleteMessageSchema.safeParse(req.body);
    const deleteForEveryone = data?.deleteForEveryone ?? false;

    const msg = await Message.findOne({ messageId });
    if (!msg) throw new AppError('Message not found.', 404);

    if (!deleteForEveryone) {
      throw new AppError('Only deleteForEveryone is supported.', 400);
    }

    await (await import('../services/MessageService')).MessageService.deleteMessage(
      {
        messageId,
        senderId: user._id.toString(),
        mutationId: (await import('crypto')).randomUUID() // In real world client should pass this
      },
      { email: user.email }
    );

    res.status(200).json({
      success: true,
      message: deleteForEveryone ? 'Message deleted for everyone.' : 'Message deleted.',
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/messages/:messageId/react ──────────────────────────────────────

const reactSchema = z.object({
  emoji: z.string().min(1).max(10, 'Emoji is too long'),
});

export const reactToMessage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { messageId } = req.params;
    const { success, data, error } = reactSchema.safeParse(req.body);
    if (!success) throw new AppError(error.errors[0].message, 400);

    const { result } = await (await import('../services/MessageService')).MessageService.reactToMessage(
      {
        messageId,
        senderId: user._id.toString(),
        emoji: data.emoji,
        mutationId: (await import('crypto')).randomUUID()
      },
      { email: user.email }
    );

    res.status(200).json({
      success: true,
      message: 'Reaction updated.',
      data: { reactions: result.reactions },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/messages/:messageId/read-receipts ───────────────────────────────

export const getReadReceipts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { messageId } = req.params;

    const msg = await Message.findOne({ messageId })
      .populate('readBy.userId', 'firstName lastName avatar')
      .lean();

    if (!msg) throw new AppError('Message not found.', 404);

    await requireRoomParticipant(msg.roomId, user._id);

    res.status(200).json({
      success: true,
      data: {
        messageId,
        readBy:      msg.readBy,
        deliveredTo: msg.deliveredTo,
      },
    });
  } catch (error) {
    next(error);
  }
};
