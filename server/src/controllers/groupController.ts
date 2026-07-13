import { Response, NextFunction } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { ChatRoom } from '../models/ChatRoom';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { SequenceService } from '../services/SequenceService';
import { RoomEvent, RoomEventType } from '../models/RoomEvent';
import { UserEvent, UserEventType } from '../models/UserEvent';
import { getIo } from '../socket';

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
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const { success, data } = addMembersSchema.safeParse(req.body);
    if (!success) throw new AppError('Invalid member IDs', 400);

    const room = await ChatRoom.findOne({ roomId }).session(session);
    if (!room) throw new AppError('Room not found', 404);
    if (room.isDM) throw new AppError('Cannot add members to a DM', 400);

    const isAdmin = room.admins.some(adminId => adminId.toString() === user._id.toString());
    if (!isAdmin) throw new AppError('Only admins can add members', 403);

    const newParticipants = data.userIds
      .filter(id => !room.participants.some(p => p.toString() === id));

    if (newParticipants.length > 0) {
      room.participants.push(...newParticipants.map(id => new mongoose.Types.ObjectId(id)));
      room.membershipRevision = (room.membershipRevision || 1) + 1;
      room.cryptoState = 'ROTATION_REQUIRED';
      await room.save({ session });

      const startRoomSeq = await SequenceService.allocateRoomSequence(roomId, 2, session);
      const membershipEvent = new RoomEvent({
        roomId,
        sequenceNumber: startRoomSeq,
        eventType: RoomEventType.MEMBERSHIP_CHANGED,
        eventVersion: 1,
        actorId: user._id.toString(),
        payload: {
          action: 'ADDED',
          memberIds: newParticipants,
          membershipRevision: room.membershipRevision
        }
      });
      const rotationEvent = new RoomEvent({
        roomId,
        sequenceNumber: startRoomSeq + 1,
        eventType: RoomEventType.ROOM_KEY_ROTATION_REQUIRED,
        eventVersion: 1,
        actorId: user._id.toString(),
        payload: {
          membershipRevision: room.membershipRevision,
          roomKeyVersion: room.roomKeyVersion
        }
      });
      await RoomEvent.insertMany([membershipEvent, rotationEvent], { session });

      const userEvents = [];
      for (const newParticipantId of newParticipants) {
        const startUserSeq = await SequenceService.allocateUserSequence(newParticipantId, 1, session);
        userEvents.push(new UserEvent({
          userId: newParticipantId,
          sequenceNumber: startUserSeq,
          eventType: UserEventType.ROOM_ACCESS_GRANTED,
          eventVersion: 1,
          payload: {
            roomId: room.roomId,
            roomKeyVersion: room.roomKeyVersion || 1,
            membershipRevision: room.membershipRevision || 1,
            roomName: room.roomName,
            isDM: room.isDM,
            isPrivate: room.isPrivate,
            avatarColor: room.avatarColor,
            previewText: room.previewText,
            participants: room.participants.map(p => p.toString()),
            encryptedRoomKeys: room.encryptedRoomKeys ? Object.fromEntries(room.encryptedRoomKeys) : {},
            addedBy: user._id.toString(),
            timestamp: new Date()
          }
        }));
      }
      if (userEvents.length > 0) {
        await UserEvent.insertMany(userEvents, { session });
      }

      await session.commitTransaction();
      session.endSession();

      const io = getIo();
      if (io) {
        io.to(roomId).emit('room_event', { events: [membershipEvent.toJSON(), rotationEvent.toJSON()] });
        for (const ev of userEvents) {
          io.to(ev.userId).emit('user_event', { events: [ev.toJSON()] });
        }
      }

      res.status(200).json({ success: true, message: 'Members added', data: { room } });
    } else {
      await session.abortTransaction();
      session.endSession();
      res.status(200).json({ success: true, message: 'No new members added', data: { room } });
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

export const kickMember = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId, userId: targetUserId } = req.params;

    const room = await ChatRoom.findOne({ roomId }).session(session);
    if (!room) throw new AppError('Room not found', 404);
    if (room.isDM) throw new AppError('Cannot kick members from a DM', 400);

    const isAdmin = room.admins.some(adminId => adminId.toString() === user._id.toString());
    const isTargetOwner = room.createdBy.toString() === targetUserId;

    if (!isAdmin) throw new AppError('Only admins can kick members', 403);
    if (isTargetOwner) throw new AppError('Cannot kick the room owner', 403);

    room.participants = room.participants.filter(p => p.toString() !== targetUserId);
    room.admins = room.admins.filter(a => a.toString() !== targetUserId);
    if (room.encryptedRoomKeys && room.encryptedRoomKeys.has(targetUserId)) {
      room.encryptedRoomKeys.delete(targetUserId);
    }
    room.membershipRevision = (room.membershipRevision || 1) + 1;
    room.cryptoState = 'ROTATION_REQUIRED';
    await room.save({ session });

    const startRoomSeq = await SequenceService.allocateRoomSequence(roomId, 2, session);
    const membershipEvent = new RoomEvent({
      roomId,
      sequenceNumber: startRoomSeq,
      eventType: RoomEventType.MEMBERSHIP_CHANGED,
      eventVersion: 1,
      actorId: user._id.toString(),
      payload: {
        action: 'REMOVED',
        memberId: targetUserId,
        membershipRevision: room.membershipRevision
      }
    });
    const rotationEvent = new RoomEvent({
      roomId,
      sequenceNumber: startRoomSeq + 1,
      eventType: RoomEventType.ROOM_KEY_ROTATION_REQUIRED,
      eventVersion: 1,
      actorId: user._id.toString(),
      payload: {
        membershipRevision: room.membershipRevision,
        roomKeyVersion: room.roomKeyVersion
      }
    });
    await RoomEvent.insertMany([membershipEvent, rotationEvent], { session });

    const startUserSeq = await SequenceService.allocateUserSequence(targetUserId, 1, session);
    const userEvent = new UserEvent({
      userId: targetUserId,
      sequenceNumber: startUserSeq,
      eventType: UserEventType.ROOM_ACCESS_REVOKED,
      eventVersion: 1,
      payload: {
        roomId,
        revokedBy: user._id.toString(),
        timestamp: new Date()
      }
    });
    await UserEvent.create([userEvent], { session });

    await session.commitTransaction();
    session.endSession();

    const io = getIo();
    if (io) {
      io.to(roomId).emit('room_event', { events: [membershipEvent.toJSON(), rotationEvent.toJSON()] });
      io.to(targetUserId).emit('user_event', { events: [userEvent.toJSON()] });
    }

    res.status(200).json({ success: true, message: 'Member kicked', data: { room } });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

export const leaveRoom = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const room = await ChatRoom.findOne({ roomId }).session(session);
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
    room.membershipRevision = (room.membershipRevision || 1) + 1;
    room.cryptoState = 'ROTATION_REQUIRED';
    await room.save({ session });

    const startRoomSeq = await SequenceService.allocateRoomSequence(roomId, 2, session);
    const membershipEvent = new RoomEvent({
      roomId,
      sequenceNumber: startRoomSeq,
      eventType: RoomEventType.MEMBERSHIP_CHANGED,
      eventVersion: 1,
      actorId: user._id.toString(),
      payload: {
        action: 'LEFT',
        memberId: user._id.toString(),
        membershipRevision: room.membershipRevision
      }
    });
    const rotationEvent = new RoomEvent({
      roomId,
      sequenceNumber: startRoomSeq + 1,
      eventType: RoomEventType.ROOM_KEY_ROTATION_REQUIRED,
      eventVersion: 1,
      actorId: user._id.toString(),
      payload: {
        membershipRevision: room.membershipRevision,
        roomKeyVersion: room.roomKeyVersion
      }
    });
    await RoomEvent.insertMany([membershipEvent, rotationEvent], { session });

    const startUserSeq = await SequenceService.allocateUserSequence(user._id.toString(), 1, session);
    const userEvent = new UserEvent({
      userId: user._id.toString(),
      sequenceNumber: startUserSeq,
      eventType: UserEventType.ROOM_ACCESS_REVOKED,
      eventVersion: 1,
      payload: {
        roomId,
        revokedBy: user._id.toString(),
        timestamp: new Date()
      }
    });
    await UserEvent.create([userEvent], { session });

    await session.commitTransaction();
    session.endSession();

    const io = getIo();
    if (io) {
      io.to(roomId).emit('room_event', { events: [membershipEvent.toJSON(), rotationEvent.toJSON()] });
      io.to(user._id.toString()).emit('user_event', { events: [userEvent.toJSON()] });
    }

    res.status(200).json({ success: true, message: 'Left room' });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

export const promoteAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const { success, data } = promoteAdminSchema.safeParse(req.body);
    if (!success) throw new AppError('Invalid request body', 400);

    const room = await ChatRoom.findOne({ roomId }).session(session);
    if (!room) throw new AppError('Room not found', 404);
    if (room.isDM) throw new AppError('Not applicable to DMs', 400);

    const isAdmin = room.admins.some(adminId => adminId.toString() === user._id.toString());
    if (!isAdmin) throw new AppError('Only admins can promote users', 403);

    const isParticipant = room.participants.some(p => p.toString() === data.userId);
    if (!isParticipant) throw new AppError('User is not a participant', 400);

    const isAlreadyAdmin = room.admins.some(a => a.toString() === data.userId);
    if (!isAlreadyAdmin) {
      room.admins.push(new mongoose.Types.ObjectId(data.userId));
      await room.save({ session });

      const startRoomSeq = await SequenceService.allocateRoomSequence(roomId, 1, session);
      const adminEvent = new RoomEvent({
        roomId,
        sequenceNumber: startRoomSeq,
        eventType: RoomEventType.ADMIN_CHANGED,
        eventVersion: 1,
        actorId: user._id.toString(),
        payload: {
          action: 'PROMOTED',
          memberId: data.userId
        }
      });
      await RoomEvent.create([adminEvent], { session });
      
      await session.commitTransaction();
      session.endSession();

      const io = getIo();
      if (io) {
        io.to(roomId).emit('room_event', { events: [adminEvent.toJSON()] });
      }
      
      res.status(200).json({ success: true, message: 'User promoted to admin', data: { room } });
    } else {
      await session.abortTransaction();
      session.endSession();
      res.status(200).json({ success: true, message: 'User already admin', data: { room } });
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

export const demoteAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId, userId: targetUserId } = req.params;

    const room = await ChatRoom.findOne({ roomId }).session(session);
    if (!room) throw new AppError('Room not found', 404);

    const isOwner = room.createdBy.toString() === user._id.toString();
    if (!isOwner) throw new AppError('Only the room owner can demote admins', 403);

    if (room.createdBy.toString() === targetUserId) {
      throw new AppError('Owner cannot be demoted', 400);
    }

    const isAlreadyAdmin = room.admins.some(a => a.toString() === targetUserId);
    if (isAlreadyAdmin) {
      room.admins = room.admins.filter(a => a.toString() !== targetUserId);
      await room.save({ session });

      const startRoomSeq = await SequenceService.allocateRoomSequence(roomId, 1, session);
      const adminEvent = new RoomEvent({
        roomId,
        sequenceNumber: startRoomSeq,
        eventType: RoomEventType.ADMIN_CHANGED,
        eventVersion: 1,
        actorId: user._id.toString(),
        payload: {
          action: 'DEMOTED',
          memberId: targetUserId
        }
      });
      await RoomEvent.create([adminEvent], { session });

      await session.commitTransaction();
      session.endSession();

      const io = getIo();
      if (io) {
        io.to(roomId).emit('room_event', { events: [adminEvent.toJSON()] });
      }
      
      res.status(200).json({ success: true, message: 'User demoted from admin', data: { room } });
    } else {
      await session.abortTransaction();
      session.endSession();
      res.status(200).json({ success: true, message: 'User not admin', data: { room } });
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

export const updateRoom = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const { success, data } = updateRoomSchema.safeParse(req.body);
    if (!success) throw new AppError('Invalid payload', 400);

    const room = await ChatRoom.findOne({ roomId }).session(session);
    if (!room) throw new AppError('Room not found', 404);

    const isAdmin = room.admins.some(adminId => adminId.toString() === user._id.toString());
    if (!isAdmin) throw new AppError('Only admins can update room details', 403);

    let changed = false;
    if (data.roomName && data.roomName !== room.roomName) {
      room.roomName = data.roomName;
      changed = true;
    }
    if (data.description !== undefined && data.description !== room.description) {
      room.description = data.description;
      changed = true;
    }
    if (data.avatarColor && data.avatarColor !== room.avatarColor) {
      room.avatarColor = data.avatarColor;
      changed = true;
    }

    if (changed) {
      await room.save({ session });

      const startRoomSeq = await SequenceService.allocateRoomSequence(roomId, 1, session);
      const metadataEvent = new RoomEvent({
        roomId,
        sequenceNumber: startRoomSeq,
        eventType: RoomEventType.ROOM_METADATA_CHANGED,
        eventVersion: 1,
        actorId: user._id.toString(),
        payload: {
          roomName: data.roomName,
          description: data.description,
          avatarColor: data.avatarColor
        }
      });
      await RoomEvent.create([metadataEvent], { session });

      await session.commitTransaction();
      session.endSession();

      const io = getIo();
      if (io) {
        io.to(roomId).emit('room_event', { events: [metadataEvent.toJSON()] });
      }

      res.status(200).json({ success: true, message: 'Room updated', data: { room } });
    } else {
      await session.abortTransaction();
      session.endSession();
      res.status(200).json({ success: true, message: 'No changes', data: { room } });
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};
