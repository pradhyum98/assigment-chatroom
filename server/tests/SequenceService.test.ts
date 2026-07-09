import mongoose from 'mongoose';
import { SequenceService } from '../src/services/SequenceService';
import { RoomSequence } from '../src/models/RoomSequence';
import { ChatRoom } from '../src/models/ChatRoom';
import { ProcessedMutation } from '../src/models/ProcessedMutation';
import connectDB from '../src/config/db';
import dotenv from 'dotenv';
dotenv.config();

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await mongoose.connection.close();
});

beforeEach(async () => {
  await RoomSequence.deleteMany({});
  await ChatRoom.deleteMany({});
  await ProcessedMutation.deleteMany({});
});

describe('SequenceService', () => {
  it('allocates a single sequence atomically', async () => {
    const roomId = 'test-room-1';
    await ChatRoom.create({
      roomId,
      roomName: 'Test Room 1',
      createdBy: new mongoose.Types.ObjectId(),
      participants: [],
      admins: [],
      isDM: false,
    });

    const session = await mongoose.startSession();
    let seq = 0;
    await session.withTransaction(async () => {
      seq = await SequenceService.allocateRoomSequence(roomId, 1, session);
    });
    session.endSession();

    expect(seq).toBe(1);

    const rs = await RoomSequence.findOne({ roomId });
    expect(rs?.currentSequence).toBe(1);

    const room = await ChatRoom.findOne({ roomId });
    expect(room?.latestSequence).toBe(1);
  });

  it('allocates a contiguous multi-event range', async () => {
    const roomId = 'test-room-2';
    await ChatRoom.create({
      roomId,
      roomName: 'Test Room 2',
      createdBy: new mongoose.Types.ObjectId(),
      participants: [],
      admins: [],
      isDM: false,
    });

    const session = await mongoose.startSession();
    let startSeq = 0;
    await session.withTransaction(async () => {
      startSeq = await SequenceService.allocateRoomSequence(roomId, 5, session);
    });
    session.endSession();

    expect(startSeq).toBe(1); // the range is 1, 2, 3, 4, 5

    const rs = await RoomSequence.findOne({ roomId });
    expect(rs?.currentSequence).toBe(5);

    const session2 = await mongoose.startSession();
    let nextStartSeq = 0;
    await session2.withTransaction(async () => {
      nextStartSeq = await SequenceService.allocateRoomSequence(roomId, 3, session2);
    });
    session2.endSession();

    expect(nextStartSeq).toBe(6); // range 6, 7, 8
    
    const rs2 = await RoomSequence.findOne({ roomId });
    expect(rs2?.currentSequence).toBe(8);
  });

  it('rolls back sequence allocation on transaction abort', async () => {
    const roomId = 'test-room-3';
    await ChatRoom.create({
      roomId,
      roomName: 'Test Room 3',
      createdBy: new mongoose.Types.ObjectId(),
      participants: [],
      admins: [],
      isDM: false,
    });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await SequenceService.allocateRoomSequence(roomId, 2, session);
        throw new Error('Abort transaction');
      });
    } catch (e) {
      // Expected
    }
    session.endSession();

    const rs = await RoomSequence.findOne({ roomId });
    expect(rs).toBeNull(); // Because upsert was rolled back
  });

  it('handles duplicate mutationId safely', async () => {
    const mutationId = 'mut-123';
    
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await SequenceService.assertUniqueMutation(mutationId, 'TEST', session);
    });
    session.endSession();

    const session2 = await mongoose.startSession();
    let errorCode = '';
    try {
      await session2.withTransaction(async () => {
        await SequenceService.assertUniqueMutation(mutationId, 'TEST', session2);
      });
    } catch (e: any) {
      errorCode = e.code;
    }
    session2.endSession();

    expect(errorCode).toBe('E_DUPLICATE_MUTATION');
  });
});
