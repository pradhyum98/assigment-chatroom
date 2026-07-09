import mongoose from 'mongoose';
import request from 'supertest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import express, { Request, Response, NextFunction } from 'express';
import { User } from '../src/models/User';
import { ChatRoom } from '../src/models/ChatRoom';
import { IdentityTransition } from '../src/models/IdentityTransition';
import { setupSocketHandlers } from '../src/socket/socketHandlers';
import authRoutes from '../src/routes/auth';
import cookieParser from 'cookie-parser';
import connectDB from '../src/config/db';
import dotenv from 'dotenv';
dotenv.config();

// userId resolved per test
let _mockUserId: string = new mongoose.Types.ObjectId().toString();
jest.mock('../src/utils/auth', () => ({
  ...jest.requireActual('../src/utils/auth'),
  verifyToken: jest.fn((token) => {
    if (token === 'valid_token_1') return { userId: _mockUserId, email: 'u1@test.com' };
    throw new Error('Invalid token');
  }),
}));

describe('E2EE Identity Lifecycle', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  afterEach(async () => {
    await User.deleteMany({ email: { $regex: /@e2e-test\.com$/ } });
    await ChatRoom.deleteMany({ roomId: '11111111-2222-3333-4444-555555555555' });
    await IdentityTransition.deleteMany({});
  });

  it('creates identity transitions and marks rooms ROTATION_REQUIRED on resetIdentity', async () => {
    const suffix = Date.now();
    const user1Id = new mongoose.Types.ObjectId();
    const user2Id = new mongoose.Types.ObjectId();
    _mockUserId = user1Id.toString();

    await User.create([
      { _id: user1Id, firstName: 'U1', lastName: 'L1', email: `u1-${suffix}@e2e-test.com`, password: 'password', identityVersion: 1 },
      { _id: user2Id, firstName: 'U2', lastName: 'L2', email: `u2-${suffix}@e2e-test.com`, password: 'password', identityVersion: 1 },
    ]);

    const room = await ChatRoom.create({
      roomId: '11111111-2222-3333-4444-555555555555',
      createdBy: user1Id,
      participants: [user1Id, user2Id],
      cryptoState: 'ACTIVE',
      isDM: true,
    });

    // Build a fresh app per test so errorHandler is always LAST
    const testApp = express();
    testApp.use(express.json());
    testApp.use(cookieParser());
    testApp.use('/api/auth', authRoutes);

    const server = createServer(testApp);
    const io = new Server(server);
    setupSocketHandlers(io);

    // Inject req.user via test middleware before resetIdentity
    testApp.post('/api/auth/test-reset', async (req: any, res: any, next: any) => {
      req.user = { _id: user1Id, email: `u1-${suffix}@e2e-test.com` };
      next();
    }, require('../src/controllers/authController').resetIdentity);

    // Error handler MUST be last
    testApp.use((err: any, req: Request, res: Response, next: NextFunction) => {
      console.error('[TEST ERROR HANDLER]', err?.message, err?.stack);
      res.status(err?.statusCode || 500).json({ success: false, message: err?.message || 'Internal error' });
    });

    const res = await request(testApp)
      .post('/api/auth/test-reset')
      .send({
        publicKey: 'new_public_key',
        encryptedPrivateKey: { ciphertext: 'c', iv: 'iv' },
      });

    if (res.status !== 200) {
      console.log('Error Response:', JSON.stringify(res.body));
    }
    expect(res.status).toBe(200);

    const updatedUser = await User.findById(user1Id);
    expect(updatedUser?.identityVersion).toBe(2);

    const updatedRoom = await ChatRoom.findById(room._id);
    expect(updatedRoom?.cryptoState).toBe('ROTATION_REQUIRED');

    const transitions = await IdentityTransition.find({ userId: user1Id });
    expect(transitions.length).toBe(1);
    expect(transitions[0].status).toBe('PENDING');

    // Cleanup this test's users
    await User.deleteMany({ _id: { $in: [user1Id, user2Id] } });
  });
});
