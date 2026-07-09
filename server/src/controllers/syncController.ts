import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { ChatRoom } from '../models/ChatRoom';
import { RoomEvent } from '../models/RoomEvent';
import { AppError } from '../middleware/errorHandler';

export const syncRoomEvents = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const afterSequence = parseInt(req.query['afterSequence'] as string) || 0;
    const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 100);

    if (afterSequence < 0) {
      throw new AppError('Invalid cursor', 400);
    }

    // Authorize
    const room = await ChatRoom.findOne({ roomId });
    if (!room) {
      throw new AppError('Room not found', 404);
    }

    const isParticipant = room.participants.some(p => p.toString() === user._id.toString());
    if (!isParticipant) {
      // Removed user semantics: 403 Forbidden
      throw new AppError('Access denied. You are no longer a participant of this room.', 403);
    }

    // Check retention and cursor-ahead conditions
    const latestSequence = room.latestSequence || 0;
    const minimumRetainedSequence = room.minimumRetainedSequence || 0;

    if (afterSequence > latestSequence) {
      // Client is somehow ahead of the server
      throw new AppError('CURSOR_AHEAD', 409);
    }

    if (afterSequence < minimumRetainedSequence && afterSequence !== 0) {
      // Cursor has fallen behind the retention window
      res.status(200).json({
        success: true,
        data: {
          events: [],
          nextCursor: afterSequence,
          hasMore: false,
          latestSequence,
          minimumRetainedSequence,
          fullResyncRequired: true
        }
      });
      return;
    }

    // If afterSequence == 0 and minimumRetainedSequence > 0, we can't sync from 0. Must resync.
    if (afterSequence === 0 && minimumRetainedSequence > 0) {
      res.status(200).json({
        success: true,
        data: {
          events: [],
          nextCursor: 0,
          hasMore: false,
          latestSequence,
          minimumRetainedSequence,
          fullResyncRequired: true
        }
      });
      return;
    }

    // Fetch events
    const events = await RoomEvent.find({
      roomId,
      sequenceNumber: { $gt: afterSequence }
    })
      .sort({ sequenceNumber: 1 })
      .limit(limit)
      .lean();

    const nextCursor = events.length > 0 ? events[events.length - 1].sequenceNumber : afterSequence;
    const hasMore = events.length === limit;

    res.status(200).json({
      success: true,
      data: {
        events,
        nextCursor,
        hasMore,
        latestSequence,
        minimumRetainedSequence,
        fullResyncRequired: false
      }
    });
  } catch (error) {
    next(error);
  }
};

export const syncUserEvents = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const afterSequence = parseInt(req.query['afterSequence'] as string) || 0;
    const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 100);

    if (afterSequence < 0) {
      throw new AppError('Invalid cursor', 400);
    }

    const { UserSequence } = await import('../models/UserSequence');
    const { UserEvent } = await import('../models/UserEvent');

    const userSequenceDoc = await UserSequence.findOne({ userId: user._id.toString() });
    const latestSequence = userSequenceDoc ? userSequenceDoc.currentSequence : 0;

    if (afterSequence > latestSequence) {
      throw new AppError('CURSOR_AHEAD', 409);
    }

    const events = await UserEvent.find({
      userId: user._id.toString(),
      sequenceNumber: { $gt: afterSequence }
    })
      .sort({ sequenceNumber: 1 })
      .limit(limit)
      .lean();

    const nextCursor = events.length > 0 ? events[events.length - 1].sequenceNumber : afterSequence;
    const hasMore = events.length === limit;

    res.status(200).json({
      success: true,
      data: {
        events,
        nextCursor,
        hasMore,
        latestSequence,
        fullResyncRequired: false
      }
    });
  } catch (error) {
    next(error);
  }
};

export const fullResync = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const token = req.query.token as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const { Message } = await import('../models/Message');
    const jwt = await import('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod';

    let snapshotSequence: number;
    let lastId: string | undefined;

    if (token) {
      // Decode and verify the opaque pagination token
      let decoded: any;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (e) {
        throw new AppError('Invalid or expired pagination token', 400);
      }

      if (decoded.roomId !== roomId || decoded.userId !== user._id.toString()) {
        throw new AppError('Invalid token context', 403);
      }

      snapshotSequence = decoded.snapshotSequence;
      lastId = decoded.lastId;
    } else {
      // First page
      const room = await ChatRoom.findOne({ roomId }).lean();
      if (!room) {
        throw new AppError('Room not found', 404);
      }
      const isParticipant = room.participants.some((p: any) => p.toString() === user._id.toString());
      if (!isParticipant) {
        throw new AppError('Access denied', 403);
      }
      snapshotSequence = room.latestSequence || 0;
    }

    // Keyset pagination using _id (which is monotonic by time).
    // We strictly limit to messages created at or before the snapshot sequence.
    const query: any = { roomId, roomSequenceNumber: { $lte: snapshotSequence } };
    if (lastId) {
      query._id = { $lt: lastId }; // Pagination cursor
    }

    const messages = await Message.find(query)
      .sort({ _id: -1 })
      .limit(limit)
      .lean();

    const hasMore = messages.length === limit;
    const nextLastId = hasMore ? messages[messages.length - 1]._id.toString() : undefined;

    let nextToken = undefined;
    if (hasMore) {
      nextToken = jwt.sign(
        {
          roomId,
          userId: user._id.toString(),
          snapshotSequence,
          lastId: nextLastId,
          type: 'full_resync'
        },
        JWT_SECRET,
        { expiresIn: '10m' }
      );
    }

    // Fetch room metadata only on the first page to save bandwidth
    let roomMetadata = undefined;
    if (!token) {
      roomMetadata = await ChatRoom.findOne({ roomId })
        .populate('participants', 'firstName lastName email isOnline lastSeen publicKey')
        .lean();
    }

    // NOTE: This storage model mutates Message documents in place (e.g. edits, receipts).
    // While we bound the query to `roomSequenceNumber <= snapshotSequence`, 
    // any edits applied *after* snapshotSequence but *before* pagination completes 
    // will be returned in their edited state. 
    // Therefore, this is not a mathematically strict immutable snapshot manifest, 
    // but rather a read-committed view bound by creation sequence.
    // The client reconciler must be idempotent to handle re-applying RoomEvents.

    res.status(200).json({
      success: true,
      data: {
        room: roomMetadata,
        latestSequence: snapshotSequence,
        messages: messages.reverse(), // Send oldest to newest in chunk
        nextToken,
        hasMore
      }
    });
  } catch (error) {
    next(error);
  }
};
