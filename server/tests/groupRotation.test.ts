import mongoose from 'mongoose';
import request from 'supertest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';
import crypto from 'crypto';
import { User } from '../src/models/User';
import { ChatRoom } from '../src/models/ChatRoom';
import { setupSocketHandlers } from '../src/socket/socketHandlers';
import roomRoutes from '../src/routes/rooms';
import cookieParser from 'cookie-parser';
import connectDB from '../src/config/db';
import { errorHandler } from '../src/middleware/errorHandler';
import dotenv from 'dotenv';
dotenv.config();

let mockUserId = new mongoose.Types.ObjectId().toString();
export const setMockUserId = (id: string) => { mockUserId = id; };

jest.mock('../src/utils/auth', () => ({
  ...jest.requireActual('../src/utils/auth'),
  verifyToken: jest.fn((token) => {
    if (token === 'valid_token_1') return { userId: mockUserId, email: 'rotation-test@example.com' };
    throw new Error('Invalid token');
  }),
}));

describe('Group Key Rotation State Machine', () => {
  let app: any;
  let io: any;
  const createdUserIds: mongoose.Types.ObjectId[] = [];
  const createdRoomIds: string[] = [];

  beforeAll(async () => {
    await connectDB();
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/rooms', roomRoutes);

    const server = createServer(app);
    io = new Server(server);
    setupSocketHandlers(io);
    app.use(errorHandler);
  });

  afterAll(async () => {
    // Cleanup by IDs tracked during tests
    if (createdUserIds.length > 0) await User.deleteMany({ _id: { $in: createdUserIds } });
    if (createdRoomIds.length > 0) await ChatRoom.deleteMany({ roomId: { $in: createdRoomIds } });
    await mongoose.connection.close();
  });

  it('rotates room keys using atomic compare-and-set and resolves state', async () => {
    const suffix = Date.now();
    const user1Id = new mongoose.Types.ObjectId();
    const user2Id = new mongoose.Types.ObjectId();
    createdUserIds.push(user1Id, user2Id);
    setMockUserId(user1Id.toString());

    await User.create([
      { _id: user1Id, firstName: 'U1', lastName: 'L1', email: `u1-${suffix}@rotation-test.com`, password: 'password', identityVersion: 1 },
      { _id: user2Id, firstName: 'U2', lastName: 'L2', email: `u2-${suffix}@rotation-test.com`, password: 'password', identityVersion: 1 },
    ]);

    const roomId = crypto.randomUUID();
    createdRoomIds.push(roomId);
    const room = await ChatRoom.create({
      roomId,
      roomName: 'Test Room 1',
      createdBy: user1Id,
      participants: [user1Id, user2Id],
      cryptoState: 'ROTATION_REQUIRED',
      membershipRevision: 2,
      roomKeyVersion: 1,
      isDM: false,
    });

    const res = await request(app)
      .post(`/api/rooms/${room.roomId}/rotate-key`)
      .set('Authorization', 'Bearer valid_token_1')
      .send({
        expectedMembershipRevision: 2,
        encryptedRoomKeys: {
          [user1Id.toString()]: { encryptedKey: 'new_key_u1', identityVersion: 1 },
          [user2Id.toString()]: { encryptedKey: 'new_key_u2', identityVersion: 1 },
        },
      });

    if (res.status !== 200) {
      console.log('Rotate error:', res.body);
    }
    expect(res.status).toBe(200);

    const updatedRoom = await ChatRoom.findById(room._id);
    expect(updatedRoom?.cryptoState).toBe('ACTIVE');
    expect(updatedRoom?.roomKeyVersion).toBe(2);
    expect(updatedRoom?.membershipRevision).toBe(2);
    const raw = await (await import('../src/models/ChatRoom')).ChatRoom.collection.findOne({ _id: room._id });
    expect(raw?.encryptedRoomKeys?.[user1Id.toString()]?.encryptedKey).toBe('new_key_u1');
  });

  it('fails rotation on concurrent membership change', async () => {
    const suffix = Date.now() + 1; // ensure different from previous
    const user1Id = new mongoose.Types.ObjectId();
    createdUserIds.push(user1Id);
    setMockUserId(user1Id.toString());

    await User.create([
      { _id: user1Id, firstName: 'U1', lastName: 'L1', email: `u1-${suffix}@rotation-test.com`, password: 'password', identityVersion: 1 },
    ]);

    const roomId = crypto.randomUUID();
    createdRoomIds.push(roomId);
    const room = await ChatRoom.create({
      roomId,
      roomName: 'Test Room 2',
      createdBy: user1Id,
      participants: [user1Id],
      cryptoState: 'ROTATION_REQUIRED',
      membershipRevision: 3,
      roomKeyVersion: 1,
      isDM: false,
    });

    const res = await request(app)
      .post(`/api/rooms/${room.roomId}/rotate-key`)
      .set('Authorization', 'Bearer valid_token_1')
      .send({
        expectedMembershipRevision: 2, // Mismatch!
        encryptedRoomKeys: {
          [user1Id.toString()]: { encryptedKey: 'new_key_u1', identityVersion: 1 },
        },
      });

    expect(res.status).toBe(409);

    const unchangedRoom = await ChatRoom.findById(room._id);
    expect(unchangedRoom?.cryptoState).toBe('ROTATION_REQUIRED');
  });
});
