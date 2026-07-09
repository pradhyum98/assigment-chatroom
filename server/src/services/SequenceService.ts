import mongoose, { ClientSession } from 'mongoose';
import { RoomSequence } from '../models/RoomSequence';
import { UserSequence } from '../models/UserSequence';
import { ProcessedMutation } from '../models/ProcessedMutation';
import { ChatRoom } from '../models/ChatRoom';

export class SequenceService {
  /**
   * Allocate a contiguous range of room sequences atomically.
   * Returns the starting sequence number of the allocated range.
   */
  static async allocateRoomSequence(
    roomId: string,
    count: number,
    session: ClientSession
  ): Promise<number> {
    const result = await RoomSequence.findOneAndUpdate(
      { roomId },
      { $inc: { currentSequence: count } },
      { new: true, upsert: true, session }
    );

    // If upsert occurred, currentSequence = count. The first sequence is 1 (if count=1)
    // Thus, start = newCurrentSequence - count + 1
    const startSequence = result.currentSequence - count + 1;

    // Update ChatRoom's latestSequence
    await ChatRoom.findOneAndUpdate(
      { roomId },
      { $set: { latestSequence: result.currentSequence } },
      { session }
    );

    return startSequence;
  }

  /**
   * Allocate a contiguous range of user sequences atomically.
   * Returns the starting sequence number of the allocated range.
   */
  static async allocateUserSequence(
    userId: string,
    count: number,
    session: ClientSession
  ): Promise<number> {
    const result = await UserSequence.findOneAndUpdate(
      { userId },
      { $inc: { currentSequence: count } },
      { new: true, upsert: true, session }
    );

    return result.currentSequence - count + 1;
  }

  /**
   * Check if a mutation has already been processed (deduplication).
   * If not, inserts the mutation record to prevent future duplicates.
   * Throws an error if the mutation already exists (handled as idempotency collision).
   */
  static async assertUniqueMutation(
    mutationId: string,
    type: string,
    session: ClientSession,
    roomId?: string,
    userId?: string
  ): Promise<void> {
    // If it exists, MongoServerError E11000 will be thrown because of the unique index on mutationId.
    // Alternatively, we can check first.
    const existing = await ProcessedMutation.findOne({ mutationId }).session(session);
    if (existing) {
      const error: any = new Error('Mutation already processed');
      error.code = 'E_DUPLICATE_MUTATION';
      throw error;
    }

    await ProcessedMutation.create([{
      mutationId,
      type,
      roomId,
      userId
    }], { session });
  }
}
