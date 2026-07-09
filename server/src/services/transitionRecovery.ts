import mongoose from 'mongoose';
import { IdentityTransition } from '../models/IdentityTransition';
import { ChatRoom } from '../models/ChatRoom';
import { logger } from '../middleware/logger';

/**
 * Recovers and resolves PENDING identity transitions that have been satisfied
 * by a subsequent room key rotation.
 */
export const recoverPendingTransitions = async (batchSize = 100): Promise<void> => {
  logger.info(`Starting durable transition recovery (batchSize=${batchSize})...`);
  
  try {
    const pendingTransitions = await IdentityTransition.find({ status: 'PENDING' })
      .limit(batchSize)
      .lean();

    if (pendingTransitions.length === 0) {
      logger.info('No pending transitions to recover.');
      return;
    }

    let resolvedCount = 0;
    let failedCount = 0;

    for (const transition of pendingTransitions) {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Lock the transition
        const lockedTransition = await IdentityTransition.findOneAndUpdate(
          { _id: transition._id, status: 'PENDING' },
          { $set: { status: 'PENDING' } }, // no-op update to acquire lock if necessary, or just load
          { session, new: true }
        );

        if (!lockedTransition) {
          await session.abortTransaction();
          session.endSession();
          continue; // Already resolved or locked by another worker
        }

        const room = await ChatRoom.findById(transition.roomId).session(session);

        if (!room) {
          lockedTransition.status = 'FAILED';
          lockedTransition.failureReason = 'Room no longer exists';
          await lockedTransition.save({ session });
          failedCount++;
          await session.commitTransaction();
          session.endSession();
          continue;
        }

        // Check if the current room envelopes contain the new identity version
        const keys: any = room.get('encryptedRoomKeys');
        const userEnvelope = keys?.get(transition.userId.toString());

        if (
          room.cryptoState === 'ACTIVE' &&
          userEnvelope &&
          userEnvelope.identityVersion === transition.newIdentityVersion &&
          room.roomKeyVersion > transition.previousRoomKeyVersion
        ) {
          lockedTransition.status = 'COMPLETED';
          lockedTransition.resolvedRoomKeyVersion = room.roomKeyVersion;
          await lockedTransition.save({ session });
          resolvedCount++;
        }

        await session.commitTransaction();
      } catch (err: any) {
        logger.error(`Error recovering transition ${transition._id}:`, err.message);
        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    }

    logger.info(`Transition recovery complete. Resolved: ${resolvedCount}, Failed: ${failedCount}`);
  } catch (err: any) {
    logger.error('Transition recovery failed:', err.message);
  }
};
