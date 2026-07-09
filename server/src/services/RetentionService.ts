import { ChatRoom } from '../models/ChatRoom';
import { RoomEvent } from '../models/RoomEvent';
import mongoose from 'mongoose';
import { logger } from '../middleware/logger';

export class RetentionService {
  /**
   * Prunes RoomEvents older than the specified age and updates the room's minimumRetainedSequence.
   * Runs inside a transaction to guarantee synchronization correctness.
   * 
   * UserEvents are explicitly NOT pruned in this version, as they require complex
   * offline-recovery pathing (e.g. ROOM_ACCESS_REVOKED) which is indefinitely retained
   * for safety.
   * 
   * @param daysToKeep The number of days of events to retain (e.g. 30)
   */
  public static async pruneRoomEvents(daysToKeep: number = 30): Promise<{ prunedCount: number, roomsUpdated: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    let prunedCount = 0;
    let roomsUpdated = 0;

    // Find all distinct rooms that have events older than the cutoff
    const roomsToPrune = await RoomEvent.distinct('roomId', { createdAt: { $lt: cutoffDate } });

    for (const roomId of roomsToPrune) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          // Find the boundary event (the latest event that is older than the cutoff)
          // We will delete all events <= this event's sequenceNumber
          const boundaryEvent = await RoomEvent.findOne({ roomId, createdAt: { $lt: cutoffDate } })
            .sort({ sequenceNumber: -1 }) // Get the HIGHEST sequence number that is STILL older than the cutoff
            .session(session)
            .lean();

          if (!boundaryEvent) return;

          const boundarySequence = boundaryEvent.sequenceNumber;

          // Transactionally update the room's minimumRetainedSequence
          // We increment minimumRetainedSequence to boundarySequence + 1
          // because events up to boundarySequence will be deleted.
          // Therefore, the lowest recoverable sequence is boundarySequence + 1.
          const roomUpdate = await ChatRoom.findOneAndUpdate(
            { roomId },
            { $max: { minimumRetainedSequence: boundarySequence + 1 } },
            { session, new: true }
          );

          if (!roomUpdate) {
            throw new Error(`Failed to update minimumRetainedSequence for room ${roomId}`);
          }

          // Delete the events
          const deleteResult = await RoomEvent.deleteMany(
            { roomId, sequenceNumber: { $lte: boundarySequence } },
            { session }
          );

          prunedCount += deleteResult.deletedCount || 0;
          roomsUpdated++;
          
          logger.info(`Pruned ${deleteResult.deletedCount} RoomEvents for room ${roomId}, new minimumRetainedSequence: ${boundarySequence + 1}`);
        });
      } catch (error: any) {
        logger.error(`Failed to prune events for room ${roomId}: ${error.message}`);
        // Continuing to the next room despite a failure
      } finally {
        await session.endSession();
      }
    }

    return { prunedCount, roomsUpdated };
  }
}
