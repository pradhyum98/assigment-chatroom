import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { ChatRoom } from '../models/ChatRoom';
import { IdentityTransition } from '../models/IdentityTransition';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { auditLog } from '../utils/auditLogger';
import { validateRoomEnvelopes } from '../utils/envelopeValidation';

export const rotateKey = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    if (!user) throw new AppError('Unauthorized', 401);

    const { roomId } = req.params;
    const { encryptedRoomKeys, expectedMembershipRevision, expectedRoomKeyVersion } = req.body;

    if (!expectedMembershipRevision) {
      throw new AppError('Missing expected membership revision', 400);
    }

    const room = await ChatRoom.findOne({ roomId }).session(session);
    if (!room) throw new AppError('Room not found', 404);

    const isParticipant = room.participants.some(p => p.toString() === user._id.toString());
    if (!isParticipant) throw new AppError('Not authorized', 403);

    if (room.membershipRevision !== expectedMembershipRevision) {
      throw new AppError('Membership revision mismatch. Another member may have joined or left.', 409);
    }
    
    if (expectedRoomKeyVersion !== undefined && room.roomKeyVersion !== expectedRoomKeyVersion) {
      throw new AppError('Room key version mismatch.', 409);
    }
    
    if (room.cryptoState !== 'ROTATION_REQUIRED') {
      throw new AppError('Room is already ACTIVE.', 409);
    }

    // Validate the complete envelope set against current participant identities
    await validateRoomEnvelopes(room.participants, encryptedRoomKeys);

    // Atomic compare-and-set — only lock on roomKeyVersion when the client provides it
    const casFilter: Record<string, any> = {
      roomId,
      membershipRevision: expectedMembershipRevision,
      cryptoState: 'ROTATION_REQUIRED',
    };
    if (expectedRoomKeyVersion !== undefined) {
      casFilter.roomKeyVersion = expectedRoomKeyVersion;
    }

    const updatedRoom = await ChatRoom.findOneAndUpdate(
      casFilter,
      {
        $set: {
          encryptedRoomKeys,
          cryptoState: 'ACTIVE',
        },
        $inc: { roomKeyVersion: 1 },
      },
      { new: true, session }
    );

    if (!updatedRoom) {
      throw new AppError('Failed to rotate key due to concurrent modification.', 409);
    }

    // Resolve ONLY pending identity transitions for this room that match the user's new identity version provided in the envelope
    const currentRotatedKeys: Record<string, any> = encryptedRoomKeys;
    
    const pendingTransitions = await IdentityTransition.find({ roomId: room._id, status: 'PENDING' }).session(session);
    for (const transition of pendingTransitions) {
      const userEnvelope = currentRotatedKeys[transition.userId.toString()];
      if (userEnvelope && userEnvelope.identityVersion === transition.newIdentityVersion) {
        transition.status = 'COMPLETED';
        transition.resolvedRoomKeyVersion = updatedRoom.roomKeyVersion;
        await transition.save({ session });
      }
    }

    const { SequenceService } = await import('../services/SequenceService');
    const { RoomEvent, RoomEventType } = await import('../models/RoomEvent');
    
    const startSequence = await SequenceService.allocateRoomSequence(roomId, 1, session);
    const rotationEvent = new RoomEvent({
      roomId,
      sequenceNumber: startSequence,
      eventType: RoomEventType.ROOM_KEY_ROTATED,
      eventVersion: 1,
      actorId: user._id.toString(),
      payload: {
        roomKeyVersion: updatedRoom.roomKeyVersion,
        rotatedBy: user._id.toString()
      }
    });

    await RoomEvent.create([rotationEvent], { session });

    await session.commitTransaction();
    session.endSession();

    // Broadcast
    const { getIo } = await import('../socket');
    const io = getIo();
    if (io) {
      io.to(roomId).emit('room_event', { events: [rotationEvent.toJSON()] });
    }

    res.status(200).json({
      success: true,
      message: 'Key rotated successfully',
      data: { room: updatedRoom }
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
