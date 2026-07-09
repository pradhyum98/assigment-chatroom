import mongoose, { ClientSession } from 'mongoose';
import { UserEvent } from '../models/UserEvent';

export class UserEventService {
  /**
   * Wrapper to execute a canonical user mutation transactionally.
   * The mutationFn is responsible for calling SequenceService.allocateUserSequence
   * and generating the fully formed UserEvent documents.
   */
  static async executeMutation<T>(
    userId: string,
    mutationFn: (session: ClientSession) => Promise<{
      result: T;
      events: import('../models/UserEvent').UserEventDoc[];
    }>
  ): Promise<{ result: T; publishedEvents: import('../models/UserEvent').UserEventDoc[] }> {
    const session = await mongoose.startSession();
    let publishedEvents: import('../models/UserEvent').UserEventDoc[] = [];
    let mutationResult: T;

    try {
      await session.withTransaction(async () => {
        const { result, events } = await mutationFn(session);
        mutationResult = result;

        if (events.length > 0) {
          publishedEvents = await UserEvent.insertMany(events, { session });
        }
      });
    } finally {
      await session.endSession();
    }

    return { result: mutationResult!, publishedEvents };
  }
}
