import { Response, NextFunction } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Message } from '../models/Message';
import { ChatRoom } from '../models/ChatRoom';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

const searchMessagesSchema = z.object({
  q: z.string().min(1, 'Search query cannot be empty'),
  roomId: z.string().optional(),
  senderId: z.string().refine((id) => mongoose.Types.ObjectId.isValid(id), 'Invalid senderId').optional(),
  mediaType: z.enum(['text', 'image', 'video', 'audio', 'file', 'voice']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  page: z.coerce.number().min(1).default(1),
});

export const searchMessages = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { success, data, error } = searchMessagesSchema.safeParse(req.query);
    if (!success) {
      throw new AppError(error.errors[0].message, 400);
    }

    const { q, roomId, senderId, mediaType, startDate, endDate, limit, page } = data;

    // Get all rooms the user is a participant in
    const userRooms = await ChatRoom.find({ participants: user._id }, { roomId: 1 }).lean();
    const allowedRoomIds = userRooms.map(r => r.roomId);

    if (roomId && !allowedRoomIds.includes(roomId)) {
      throw new AppError('You do not have access to search in this room', 403);
    }

    const query: any = {
      $text: { $search: q },
      deletedForEveryone: false,
    };

    if (roomId) {
      query.roomId = roomId;
    } else {
      query.roomId = { $in: allowedRoomIds };
    }

    if (senderId) query.senderId = new mongoose.Types.ObjectId(senderId);
    if (mediaType) query.type = mediaType;
    
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const messages = await Message.find(query, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } }) // Sort by text search relevance
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'firstName lastName email avatarColor')
      .lean();

    const total = await Message.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        messages,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};
