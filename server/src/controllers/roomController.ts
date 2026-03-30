import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ChatRoom } from '../models/ChatRoom';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../middleware/logger';
import { AuthRequest } from '../types';

const createRoomSchema = z.object({
  roomName: z
    .string()
    .min(2, 'Provide a room name (at least 2 characters)')
    .max(100, 'Room name is too long')
    .trim(),
});

export const createRoom = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
  const getRandomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { success, data, error } = createRoomSchema.safeParse(req.body);
    if (!success) {
      throw new AppError(error.errors[0].message, 400);
    }

    const { roomName } = data;

    const room = await ChatRoom.create({
      roomId: uuidv4(),
      roomName,
      avatarColor: getRandomColor(),
      previewText: 'Click to start chatting',
      createdBy: user._id,
      participants: [user._id],
    });

    const populated = await room.populate('createdBy', 'firstName lastName email');

    logger.info(`New chatroom developed: "${roomName}" by ${user.email}`);

    res.status(201).json({
      success: true,
      message: 'Room created successfully.',
      data: { room: populated },
    });
  } catch (error) {
    next(error);
  }
};

export const getRooms = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rooms = await ChatRoom.find()
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).set('Cache-Control', 'no-store, max-age=0').json({
      success: true,
      message: 'Active rooms retrieved.',
      data: { rooms },
    });
  } catch (error) {
    next(error);
  }
};

export const joinRoom = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const room = await ChatRoom.findOne({ roomId });

    if (!room) throw new AppError('This room no longer exists.', 404);

    const alreadyJoined = room.participants.some(
      (p) => p.toString() === user._id
    );

    if (!alreadyJoined) {
      room.participants.push(user._id as any);
      await room.save();
      logger.info(`User ${user.email} entered room: ${roomId}`);
    }

    const populated = await room.populate('createdBy', 'firstName lastName email');

    res.status(200).json({
      success: true,
      message: alreadyJoined ? 'Rejoined room.' : 'Joined successfully.',
      data: { room: populated },
    });
  } catch (error) {
    next(error);
  }
};

export const getRoomById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { roomId } = req.params;
    const room = await ChatRoom.findOne({ roomId })
      .populate('createdBy', 'firstName lastName email')
      .lean();

    if (!room) throw new AppError('Room not found.', 404);

    res.status(200).json({
      success: true,
      message: 'Room details retrieved.',
      data: { room },
    });
  } catch (error) {
    next(error);
  }
};
