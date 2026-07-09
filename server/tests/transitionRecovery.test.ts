import mongoose from 'mongoose';
import { User } from '../src/models/User';
import { ChatRoom } from '../src/models/ChatRoom';
import { IdentityTransition } from '../src/models/IdentityTransition';
import { recoverPendingTransitions } from '../src/services/transitionRecovery';
import connectDB from '../src/config/db';
import dotenv from 'dotenv';
dotenv.config();

describe('Transition Recovery Service', () => {
  let user1: any;

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await ChatRoom.deleteMany({});
    await IdentityTransition.deleteMany({});
    
    user1 = await User.create({
      firstName: 'U1', lastName: 'L1', email: 'u1@test.com', password: 'password', identityVersion: 2
    });
  });

  it('resolves a satisfied transition', async () => {
    const room = await ChatRoom.create({
      roomId: 'room-1',
      roomName: 'Test Room',
      createdBy: user1._id,
      participants: [user1._id],
      isDM: false,
      cryptoState: 'ACTIVE',
      roomKeyVersion: 2,
      membershipRevision: 1,
      encryptedRoomKeys: { [user1._id.toString()]: { encryptedKey: 'key', identityVersion: 2 } }
    });

    const transition = await IdentityTransition.create({
      userId: user1._id,
      roomId: room._id,
      previousIdentityVersion: 1,
      newIdentityVersion: 2,
      requiredMembershipRevision: 1,
      previousRoomKeyVersion: 1,
      status: 'PENDING'
    });

    await recoverPendingTransitions();

    const updated = await IdentityTransition.findById(transition._id);
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.resolvedRoomKeyVersion).toBe(2);
  });

  it('leaves unsatisfied transition as PENDING', async () => {
    const room = await ChatRoom.create({
      roomId: 'room-2',
      roomName: 'Test Room 2',
      createdBy: user1._id,
      participants: [user1._id],
      isDM: false,
      cryptoState: 'ROTATION_REQUIRED', // Not ACTIVE yet
      roomKeyVersion: 1,
      membershipRevision: 1,
      encryptedRoomKeys: { [user1._id.toString()]: { encryptedKey: 'key', identityVersion: 1 } }
    });

    const transition = await IdentityTransition.create({
      userId: user1._id,
      roomId: room._id,
      previousIdentityVersion: 1,
      newIdentityVersion: 2,
      requiredMembershipRevision: 1,
      previousRoomKeyVersion: 1,
      status: 'PENDING'
    });

    await recoverPendingTransitions();

    const updated = await IdentityTransition.findById(transition._id);
    expect(updated?.status).toBe('PENDING');
  });

  it('marks transition FAILED if room no longer exists', async () => {
    const fakeRoomId = new mongoose.Types.ObjectId();
    const transition = await IdentityTransition.create({
      userId: user1._id,
      roomId: fakeRoomId,
      previousIdentityVersion: 1,
      newIdentityVersion: 2,
      requiredMembershipRevision: 1,
      previousRoomKeyVersion: 1,
      status: 'PENDING'
    });

    await recoverPendingTransitions();

    const updated = await IdentityTransition.findById(transition._id);
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failureReason).toContain('Room no longer exists');
  });
});
