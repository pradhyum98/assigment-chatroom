import { Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
const uuidv4 = () => crypto.randomUUID();
import mongoose from 'mongoose';
import { ChatRoom } from '../models/ChatRoom';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import {  } from '../middleware/logger';
import { AuthRequest } from '../types';
import { auditLog } from '../utils/auditLogger';

const createRoomSchema = z.object({
  roomName: z
    .string()
    .min(2, 'Provide a room name (at least 2 characters)')
    .max(50, 'Room name is too long (max 50 characters)')
    .trim(),
  participants: z.array(z.string()).optional(), // Add participants for private groups
  encryptedRoomKeys: z.record(z.string()).optional(), // Record<userId, encryptedKey>
});

/**
 * Get or create a direct message (DM) room with a friend
 */
export const createOrGetDM = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { friendId } = req.params;

    if (!friendId || !mongoose.Types.ObjectId.isValid(friendId)) {
      throw new AppError('A valid friend ID is required.', 400);
    }

    // Security check: Verify that they are friends
    const currentUser = await User.findById(user._id);
    if (!currentUser) throw new AppError('User not found.', 404);

    const isFriend = currentUser.friends.some(
      (fId) => fId.toString() === friendId.toString()
    );

    if (!isFriend) {
      throw new AppError('You can only start a direct message with your friends.', 403);
    }

    // Normalize participant ordering to avoid duplicate DM rooms
    const participantIds = [user._id.toString(), friendId.toString()].sort();

    // Query for an existing DM room with these exact two participants
    let room = await ChatRoom.findOne({
      isDM: true,
      participants: { $all: participantIds, $size: 2 },
    });

    if (room) {
      const populated = await room.populate([
        { path: 'participants', select: 'firstName lastName email isOnline lastSeen publicKey' },
        { path: 'lastMessage' }
      ]);
      res.status(200).json({
        success: true,
        message: 'DM room retrieved.',
        data: { room: populated },
      });
      return;
    }

    // Generate random avatar color
    const COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
    const getRandomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

    try {
      // Create a new DM room
      room = await ChatRoom.create({
        roomId: uuidv4(),
        isDM: true,
        isPrivate: true,
        avatarColor: getRandomColor(),
        previewText: 'Click to start chatting',
        createdBy: user._id,
        participants: participantIds,
        encryptedRoomKeys: req.body.encryptedRoomKeys || {},
      });

      auditLog.dmRoomCreated(room.roomId, user.email, participantIds);
    } catch (err: any) {
      // Catch concurrent creation index collision
      if (err.code === 11000) {
        room = await ChatRoom.findOne({
          isDM: true,
          participants: { $all: participantIds, $size: 2 },
        });
        if (room) {
          const populated = await room.populate([
            { path: 'participants', select: 'firstName lastName email isOnline lastSeen publicKey' },
            { path: 'lastMessage' }
          ]);
          res.status(200).json({
            success: true,
            message: 'DM room retrieved.',
            data: { room: populated },
          });
          return;
        }
      }
      throw err;
    }

    const populated = await room.populate([
      { path: 'participants', select: 'firstName lastName email isOnline lastSeen publicKey' },
      { path: 'lastMessage' }
    ]);

    res.status(201).json({
      success: true,
      message: 'DM room created successfully.',
      data: { room: populated },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new private group room
 */
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

    const { roomName, participants = [], encryptedRoomKeys = {} } = data;

    // Validate all group participants are friends
    const currentUser = await User.findById(user._id);
    if (!currentUser) throw new AppError('User not found.', 404);

    const validParticipants = [user._id.toString()];

    for (const pId of participants) {
      if (mongoose.Types.ObjectId.isValid(pId)) {
        const isFriend = currentUser.friends.some((fId) => fId.toString() === pId);
        if (isFriend) {
          validParticipants.push(pId);
        }
      }
    }

    const room = await ChatRoom.create({
      roomId: uuidv4(),
      roomName,
      avatarColor: getRandomColor(),
      previewText: 'Click to start chatting',
      createdBy: user._id,
      participants: validParticipants,
      isDM: false,
      isPrivate: true, // Private-by-default for security
      admins: [user._id],
      encryptedRoomKeys,
    });

    const populated = await room.populate([
      { path: 'createdBy', select: 'firstName lastName email' },
      { path: 'participants', select: 'firstName lastName email isOnline lastSeen publicKey' },
      { path: 'lastMessage' }
    ]);

    auditLog.dmRoomCreated(room.roomId, user.email, validParticipants);

    res.status(201).json({
      success: true,
      message: 'Group room created successfully.',
      data: { room: populated },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all rooms where the current user is a participant
 */
export const getRooms = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const rooms = await ChatRoom.find({
      participants: user._id,
    })
      .populate('createdBy', 'firstName lastName email')
      .populate('participants', 'firstName lastName email isOnline lastSeen publicKey')
      .populate('lastMessage')
      .sort({ updatedAt: -1 })
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

/**
 * Join a room (restricted for security)
 */
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

    // If it's a DM, you cannot join it by guessing the ID
    if (room.isDM) {
      throw new AppError('You are not authorized to join this room.', 403);
    }

    // For private group rooms, you must already be an invited participant
    const isParticipant = room.participants.some(
      (p) => p.toString() === user._id.toString()
    );

    if (!isParticipant) {
      throw new AppError('You must be invited to join this private room.', 403);
    }

    const populated = await room.populate('createdBy', 'firstName lastName email');

    res.status(200).json({
      success: true,
      message: 'Rejoined room.',
      data: { room: populated },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get details for a specific room (restricted to participants)
 */
export const getRoomById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const room = await ChatRoom.findOne({ roomId })
      .populate('createdBy', 'firstName lastName email')
      .populate('participants', 'firstName lastName email')
      .lean();

    if (!room) throw new AppError('Room not found.', 404);

    // Security check: Must be a participant of the room
    const isParticipant = room.participants.some(
      (p: any) => p._id.toString() === user._id.toString()
    );

    if (!isParticipant) {
      throw new AppError('You are not authorized to access this room.', 403);
    }

    res.status(200).json({
      success: true,
      message: 'Room details retrieved.',
      data: { room },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Remove a member from a room and update encrypted keys for remaining members
 */
export const removeMember = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId, memberId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      throw new AppError('Invalid member ID.', 400);
    }

    const room = await ChatRoom.findOne({ roomId }).session(session);
    if (!room) throw new AppError('Room not found.', 404);

    if (room.isDM) {
      throw new AppError('Cannot remove members from a DM.', 400);
    }

    // Only admins or the member themselves can remove
    const isAdmin = room.admins.some((adminId) => adminId.toString() === user._id.toString());
    const isSelf = user._id.toString() === memberId;
    if (!isAdmin && !isSelf) {
      throw new AppError('Only admins can remove members.', 403);
    }

    // We must ensure the mutation is idempotent using mutationId if provided, but the client doesn't send it yet in the legacy route.
    // We'll generate one for the server-side transaction for now, or just skip assertUniqueMutation for legacy endpoints until client updates.

    room.participants = room.participants.filter((pId) => pId.toString() !== memberId);
    room.admins = room.admins.filter((adminId) => adminId.toString() !== memberId);
    
    // Drop the departed member's key from the map (using Mongoose map manipulation)
    if (room.encryptedRoomKeys) {
      room.encryptedRoomKeys.delete(memberId);
    }

    // Advance membership revision and force rotation
    room.membershipRevision = (room.membershipRevision || 1) + 1;
    room.cryptoState = 'ROTATION_REQUIRED';

    await room.save({ session });

    // Generate RoomEvents
    const { SequenceService } = await import('../services/SequenceService');
    const { RoomEvent, RoomEventType } = await import('../models/RoomEvent');
    const { UserEvent, UserEventType } = await import('../models/UserEvent');

    const startRoomSeq = await SequenceService.allocateRoomSequence(roomId, 2, session);
    const membershipEvent = new RoomEvent({
      roomId,
      sequenceNumber: startRoomSeq,
      eventType: RoomEventType.MEMBERSHIP_CHANGED,
      eventVersion: 1,
      actorId: user._id.toString(),
      payload: {
        action: 'REMOVED',
        memberId,
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

    // Generate UserEvent for the removed user
    const startUserSeq = await SequenceService.allocateUserSequence(memberId, 1, session);
    const userEvent = new UserEvent({
      userId: memberId,
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

    // Broadcast room events
    const { getIo } = await import('../socket');
    const io = getIo();
    if (io) {
      io.to(roomId).emit('room_event', { events: [membershipEvent.toJSON(), rotationEvent.toJSON()] });
      io.to(memberId).emit('user_event', { events: [userEvent.toJSON()] });
    }

    res.status(200).json({
      success: true,
      message: 'Member removed and keys rotated.',
      data: { room },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};
