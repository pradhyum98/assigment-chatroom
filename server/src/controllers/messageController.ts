import { Request, Response, NextFunction } from 'express';
import { Message } from '../models/Message';
import { AppError } from '../middleware/errorHandler';

export const getMessagesByRoom = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { roomId } = req.params;
    const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 100);
    const before = req.query['before'] as string | undefined;

    const query: Record<string, unknown> = { roomId };

    if (before) {
      const beforeDate = new Date(before);
      if (isNaN(beforeDate.getTime())) {
        throw new AppError('The "before" timestamp provided is invalid.', 400);
      }
      query['timestamp'] = { $lt: beforeDate };
    }

    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    // Reversing to maintain chronological order for the client
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
