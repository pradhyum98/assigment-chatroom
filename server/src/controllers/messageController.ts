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

    // Only text messages can be edited
    if (msg.type !== 'text') throw new AppError('Only text messages can be edited.', 400);

    // Only the original sender may edit
    if (msg.senderId.toString() !== user._id) {
      throw new AppError('You can only edit your own messages.', 403);
    }

    // Enforce edit time window
    const ageMs = Date.now() - new Date(msg.timestamp).getTime();
    if (ageMs > EDIT_WINDOW_MS) {
      throw new AppError('Messages can only be edited within 15 minutes of sending.', 403);
    }

    // Verify room membership
    await requireRoomParticipant(msg.roomId, user._id);

    // Sanitize: strip HTML tags and dangerous protocol references
    let sanitizedContent = data.content.replace(/<[^>]*>/g, '');
    sanitizedContent = sanitizedContent.replace(/\b(javascript|vbscript|data|blob):/gi, '');

    msg.content  = sanitizedContent;
    msg.editedAt = new Date();
    await msg.save();

    res.status(200).json({
      success: true,
      message: 'Message edited.',
      data: { message: msg },
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

    await requireRoomParticipant(msg.roomId, user._id);

    if (deleteForEveryone) {
      // Only the sender can delete for everyone (within 15 min)
      if (msg.senderId.toString() !== user._id) {
        throw new AppError('Only the sender can delete a message for everyone.', 403);
      }
      const ageMs = Date.now() - new Date(msg.timestamp).getTime();
      if (ageMs > EDIT_WINDOW_MS) {
        throw new AppError('Messages can only be deleted for everyone within 15 minutes.', 403);
      }
      msg.deletedForEveryone = true;
      msg.deletedAt          = new Date();
      msg.content            = '';
      await msg.save();
    } else {
      // Delete for self: soft-delete by recording the user's deletion timestamp
      // For simplicity we use the same deletedAt field (sender perspective only)
      msg.deletedAt = new Date();
      await msg.save();
    }

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

    const msg = await Message.findOne({ messageId });
    if (!msg) throw new AppError('Message not found.', 404);

    await requireRoomParticipant(msg.roomId, user._id);

    const userId    = new mongoose.Types.ObjectId(user._id);
    const existingIdx = msg.reactions.findIndex(
      (r) => r.userId.toString() === user._id && r.emoji === data.emoji
    );

    if (existingIdx !== -1) {
      // Toggle off — remove existing reaction
      msg.reactions.splice(existingIdx, 1);
    } else {
      // Add reaction
      msg.reactions.push({ emoji: data.emoji, userId, createdAt: new Date() });
    }

    await msg.save();

    res.status(200).json({
      success: true,
      message: 'Reaction updated.',
      data: { reactions: msg.reactions },
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
