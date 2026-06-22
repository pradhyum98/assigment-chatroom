import { Response, NextFunction } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { ChatRoom } from '../models/ChatRoom';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

const updateRoomSchema = z.object({
  roomName: z.string().min(2).max(100).optional(),
  description: z.string().max(300).optional(),
  avatarColor: z.string().optional(),
});

const addMembersSchema = z.object({
  userIds: z.array(z.string().refine(id => mongoose.Types.ObjectId.isValid(id), 'Invalid ObjectId')),
});

const promoteAdminSchema = z.object({
  userId: z.string().refine(id => mongoose.Types.ObjectId.isValid(id), 'Invalid ObjectId'),
});

export const addMembers = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const { success, data } = addMembersSchema.safeParse(req.body);
    if (!success) throw new AppError('Invalid member IDs', 400);

    const room = await ChatRoom.findOne({ roomId });
    if (!room) throw new AppError('Room not found', 404);
    if (room.isDM) throw new AppError('Cannot add members to a DM', 400);

    const isAdmin = room.admins.some(adminId => adminId.toString() === user._id.toString());
    if (!isAdmin) throw new AppError('Only admins can add members', 403);

    const newParticipants = data.userIds
      .filter(id => !room.participants.some(p => p.toString() === id))
      .map(id => new mongoose.Types.ObjectId(id));

    if (newParticipants.length > 0) {
      room.participants.push(...newParticipants);
      await room.save();
    }

    res.status(200).json({ success: true, message: 'Members added', data: { room } });
  } catch (error) {
    next(error);
  }
};

export const kickMember = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId, userId: targetUserId } = req.params;

    const room = await ChatRoom.findOne({ roomId });
    if (!room) throw new AppError('Room not found', 404);
    if (room.isDM) throw new AppError('Cannot kick members from a DM', 400);

    const isAdmin = room.admins.some(adminId => adminId.toString() === user._id.toString());
    const isOwner = room.createdBy.toString() === user._id.toString();
    const isTargetOwner = room.createdBy.toString() === targetUserId;

    if (!isAdmin) throw new AppError('Only admins can kick members', 403);
    if (isTargetOwner) throw new AppError('Cannot kick the room owner', 403);

    room.participants = room.participants.filter(p => p.toString() !== targetUserId);
    room.admins = room.admins.filter(a => a.toString() !== targetUserId);
    if (room.encryptedRoomKeys && room.encryptedRoomKeys.has(targetUserId)) {
      room.encryptedRoomKeys.delete(targetUserId);
    }
    await room.save();

    res.status(200).json({ success: true, message: 'Member kicked', data: { room } });
  } catch (error) {
    next(error);
  }
};

export const leaveRoom = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const room = await ChatRoom.findOne({ roomId });
    if (!room) throw new AppError('Room not found', 404);
    if (room.isDM) throw new AppError('Cannot leave a DM', 400);

    if (room.createdBy.toString() === user._id.toString()) {
      throw new AppError('Room owner cannot leave without deleting or transferring ownership', 400);
    }

    room.participants = room.participants.filter(p => p.toString() !== user._id.toString());
    room.admins = room.admins.filter(a => a.toString() !== user._id.toString());
    if (room.encryptedRoomKeys && room.encryptedRoomKeys.has(user._id.toString())) {
      room.encryptedRoomKeys.delete(user._id.toString());
    }
    await room.save();

    res.status(200).json({ success: true, message: 'Left room' });
  } catch (error) {
    next(error);
  }
};

export const promoteAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const { success, data } = promoteAdminSchema.safeParse(req.body);
    if (!success) throw new AppError('Invalid request body', 400);

    const room = await ChatRoom.findOne({ roomId });
    if (!room) throw new AppError('Room not found', 404);
    if (room.isDM) throw new AppError('Not applicable to DMs', 400);

    const isAdmin = room.admins.some(adminId => adminId.toString() === user._id.toString());
    if (!isAdmin) throw new AppError('Only admins can promote users', 403);

    const isParticipant = room.participants.some(p => p.toString() === data.userId);
    if (!isParticipant) throw new AppError('User is not a participant', 400);

    const isAlreadyAdmin = room.admins.some(a => a.toString() === data.userId);
    if (!isAlreadyAdmin) {
      room.admins.push(new mongoose.Types.ObjectId(data.userId));
      await room.save();
    }

    res.status(200).json({ success: true, message: 'User promoted to admin', data: { room } });
  } catch (error) {
    next(error);
  }
};

export const demoteAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId, userId: targetUserId } = req.params;

    const room = await ChatRoom.findOne({ roomId });
    if (!room) throw new AppError('Room not found', 404);

    const isOwner = room.createdBy.toString() === user._id.toString();
    if (!isOwner) throw new AppError('Only the room owner can demote admins', 403);

    if (room.createdBy.toString() === targetUserId) {
      throw new AppError('Owner cannot be demoted', 400);
    }

    room.admins = room.admins.filter(a => a.toString() !== targetUserId);
    await room.save();

    res.status(200).json({ success: true, message: 'User demoted from admin', data: { room } });
  } catch (error) {
    next(error);
  }
};

export const updateRoom = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const { success, data } = updateRoomSchema.safeParse(req.body);
    if (!success) throw new AppError('Invalid payload', 400);

    const room = await ChatRoom.findOne({ roomId });
    if (!room) throw new AppError('Room not found', 404);

    const isAdmin = room.admins.some(adminId => adminId.toString() === user._id.toString());
    if (!isAdmin) throw new AppError('Only admins can update room details', 403);

    if (data.roomName) room.roomName = data.roomName;
    if (data.description !== undefined) room.description = data.description;
    if (data.avatarColor) room.avatarColor = data.avatarColor;

    await room.save();

    res.status(200).json({ success: true, message: 'Room updated', data: { room } });
  } catch (error) {
    next(error);
  }
};
