import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { Message } from '../src/models/Message';
import { ChatRoom } from '../src/models/ChatRoom';
import { User } from '../src/models/User';
import { setupSocketHandlers } from '../src/socket/socketHandlers';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('Message Idempotency and Deduplication', () => {
  let testUser: any;
  let testRoom: any;
  let registeredHandlers: Record<string, Function> = {};
  let mockSocket: any;
  let mockIo: any;

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not defined');
    }
    await mongoose.connect(mongoUri);
    await Message.syncIndexes();

    // Create a clean test user
    testUser = await User.create({
      firstName: 'Idempotency',
      lastName: 'Tester',
      email: `test_idemp_${Date.now()}@example.com`,
      password: 'password123',
      friends: [],
      privacyLastSeen: 'everyone',
      privacyOnlineStatus: 'everyone'
    });

    // Create a clean test room
    testRoom = await ChatRoom.create({
      roomId: crypto.randomUUID(),
      roomName: 'Idempotency Test Room',
      avatarColor: '#10b981',
      previewText: 'No messages yet',
      createdBy: testUser._id,
      participants: [testUser._id],
      isDM: false,
      isPrivate: true,
      admins: [testUser._id]
    });

    // Mock Socket.IO server and client socket
    mockSocket = {
      id: 'mock-socket-id',
      handshake: {
        address: '127.0.0.1',
        auth: { token: 'mock-token' }
      },
      user: testUser,
      join: jest.fn(),
      to: jest.fn().mockReturnValue({
        emit: jest.fn()
      }),
      emit: jest.fn(),
      on: (event: string, handler: Function) => {
        registeredHandlers[event] = handler;
      },
      disconnect: jest.fn()
    };

    mockIo = {
      use: jest.fn(), // Skip connection middleware for tests
      on: (event: string, handler: Function) => {
        if (event === 'connection') {
          (mockIo as any).connectionHandler = handler;
        }
      },
      to: jest.fn().mockReturnValue({
        emit: jest.fn()
      })
    };

    // Initialize handlers
    setupSocketHandlers(mockIo);

    // Explicitly trigger connection and wait for mongoose queries inside connection listener to complete
    if ((mockIo as any).connectionHandler) {
      await (mockIo as any).connectionHandler(mockSocket);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  afterAll(async () => {
    // Cleanup collections
    if (testUser) {
      await User.deleteOne({ _id: testUser._id });
    }
    if (testRoom) {
      await ChatRoom.deleteOne({ roomId: testRoom.roomId });
      await Message.deleteMany({ roomId: testRoom.roomId });
    }
    await mongoose.disconnect();
  });

  test('Successful send triggers message creation and invokes ACK callback', async () => {
    const handler = registeredHandlers['send_message'];
    expect(handler).toBeDefined();

    const clientMsgId = crypto.randomUUID();
    const payload = {
      roomId: testRoom.roomId,
      senderId: testUser._id.toString(),
      senderName: 'Idempotency Tester',
      content: 'Hello, this is a test message!',
      clientMsgId,
      type: 'text'
    };

    const ack = jest.fn();
    await handler(payload, ack);

    // Verify ACK callback invoked with success state
    expect(ack).toHaveBeenCalled();
    const response = ack.mock.calls[0][0];
    expect(response.ok).toBe(true);
    expect(response.clientMsgId).toBe(clientMsgId);
    expect(response.message).toBeDefined();

    // Verify database record exists
    const dbMsg = await Message.findOne({ clientMsgId });
    expect(dbMsg).toBeDefined();
    expect(dbMsg?.content).toBe('Hello, this is a test message!');
  });

  test('Duplicate send with same clientMsgId returns existing message and does not duplicate in database', async () => {
    const handler = registeredHandlers['send_message'];
    const clientMsgId = crypto.randomUUID();
    const payload = {
      roomId: testRoom.roomId,
      senderId: testUser._id.toString(),
      senderName: 'Idempotency Tester',
      content: 'Unique message content',
      clientMsgId,
      type: 'text'
    };

    // First send
    const ack1 = jest.fn();
    await handler(payload, ack1);
    expect(ack1).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));

    // Second send (retry of duplicate payload)
    const ack2 = jest.fn();
    await handler(payload, ack2);

    expect(ack2).toHaveBeenCalled();
    const response = ack2.mock.calls[0][0];
    expect(response.ok).toBe(true);
    expect(response.clientMsgId).toBe(clientMsgId);
    expect(response.message).toBeDefined();

    // Verify database counts to verify no duplicate entry
    const count = await Message.countDocuments({ clientMsgId });
    expect(count).toBe(1);
  });

  test('Sender ID spoofing is rejected with FORBIDDEN error in ACK', async () => {
    const handler = registeredHandlers['send_message'];
    const clientMsgId = crypto.randomUUID();
    const payload = {
      roomId: testRoom.roomId,
      senderId: new mongoose.Types.ObjectId().toString(), // Spoofed ID
      senderName: 'Spoofer',
      content: 'I am spoofing!',
      clientMsgId,
      type: 'text'
    };

    const ack = jest.fn();
    await handler(payload, ack);

    expect(ack).toHaveBeenCalled();
    const response = ack.mock.calls[0][0];
    expect(response.ok).toBe(false);
    expect(response.errorCode).toBe('FORBIDDEN');
    expect(response.retryable).toBe(false);
  });

  test('Send to unauthorized room is rejected with NOT_MEMBER error in ACK', async () => {
    const handler = registeredHandlers['send_message'];
    const clientMsgId = crypto.randomUUID();
    const payload = {
      roomId: crypto.randomUUID(), // Random room ID user is not in
      senderId: testUser._id.toString(),
      senderName: 'Idempotency Tester',
      content: 'Testing unauthorized access',
      clientMsgId,
      type: 'text'
    };

    const ack = jest.fn();
    await handler(payload, ack);

    expect(ack).toHaveBeenCalled();
    const response = ack.mock.calls[0][0];
    expect(response.ok).toBe(false);
    expect(response.errorCode).toBe('NOT_MEMBER');
    expect(response.retryable).toBe(false);
  });

  test('Invalid payload structure returns INVALID_PAYLOAD error in ACK', async () => {
    const handler = registeredHandlers['send_message'];
    const payload = {
      roomId: 'not-a-uuid', // Invalid UUID
      senderId: testUser._id.toString(),
      senderName: 'Idempotency Tester',
      content: '', // Empty text message
      clientMsgId: 'not-a-uuid-either',
      type: 'text'
    };

    const ack = jest.fn();
    await handler(payload, ack);

    expect(ack).toHaveBeenCalled();
    const response = ack.mock.calls[0][0];
    expect(response.ok).toBe(false);
    expect(response.errorCode).toBe('INVALID_PAYLOAD');
    expect(response.retryable).toBe(false);
  });
});
