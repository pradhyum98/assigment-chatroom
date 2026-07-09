import mongoose, { ClientSession } from 'mongoose';
import { RoomEvent } from '../models/RoomEvent';
import { getIo } from '../socket';

export class RoomEventService {
  /**
   * Wrapper to execute a canonical room mutation transactionally.
   * The mutationFn is responsible for calling SequenceService.allocateRoomSequence
   * and generating the fully formed RoomEvent documents.
   */
  static async executeMutation<T>(
    mutationFn: (session: ClientSession) => Promise<{
      result: T;
      events: import('../models/RoomEvent').RoomEventDoc[];
    }>
  ): Promise<{ result: T; publishedEvents: import('../models/RoomEvent').RoomEventDoc[] }> {
    const session = await mongoose.startSession();
    let publishedEvents: import('../models/RoomEvent').RoomEventDoc[] = [];
    let mutationResult: T;

    try {
      await session.withTransaction(async () => {
        const { result, events } = await mutationFn(session);
        mutationResult = result;

        if (events.length > 0) {
          publishedEvents = await RoomEvent.insertMany(events, { session });
        }
      });
    } finally {
      await session.endSession();
    }

    // Best-effort socket broadcast AFTER commit
    if (publishedEvents.length > 0) {
      const io = getIo();
      if (io) {
        // Assuming all events in a single mutation belong to the same room
        const roomId = publishedEvents[0].roomId;
        for (const event of publishedEvents) {
          io.to(roomId).emit('room_event', event);
        }
      }
    }

    return { result: mutationResult!, publishedEvents };
  }
}
