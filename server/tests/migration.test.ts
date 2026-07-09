import mongoose from 'mongoose';
import { User } from '../src/models/User';
import { ChatRoom } from '../src/models/ChatRoom';
import connectDB from '../src/config/db';
import migrate from '../src/migrations/02_initialize_room_crypto_state';
import dotenv from 'dotenv';
dotenv.config();

const SUFFIX = `mig-${Date.now()}`;

describe('Migration 02_initialize_room_crypto_state', () => {
  let user1: any, user2: any;
  const createdRoomIds: mongoose.Types.ObjectId[] = [];
  const createdUserIds: mongoose.Types.ObjectId[] = [];

  beforeAll(async () => {
    await connectDB();
    // Create users once for all tests (unique emails)
    user1 = await User.create({
      firstName: 'U1', lastName: 'L1', email: `u1-${SUFFIX}@migration-test.com`, password: 'password', identityVersion: 2,
    });
    user2 = await User.create({
      firstName: 'U2', lastName: 'L2', email: `u2-${SUFFIX}@migration-test.com`, password: 'password', identityVersion: 1,
    });
    createdUserIds.push(user1._id, user2._id);
  });

  afterAll(async () => {
    await ChatRoom.deleteMany({ _id: { $in: createdRoomIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await mongoose.connection.close();
  });

  it('sets legacy unverifiable envelope rooms to ROTATION_REQUIRED', async () => {
    const room = await ChatRoom.create({
      roomId: `legacy-${SUFFIX}`,
      roomName: 'Test Legacy',
      createdBy: user1._id,
      participants: [user1._id],
      isDM: false,
    });
    createdRoomIds.push(room._id);

    // Bypass Mongoose to set legacy Map<string, string>
    await ChatRoom.collection.updateOne(
      { _id: room._id },
      { $set: { encryptedRoomKeys: { [user1._id.toString()]: 'base64_key' } } }
    );

    await migrate(false);

    // Use raw to avoid schema validation on legacy data
    const raw = await ChatRoom.collection.findOne({ _id: room._id });
    expect(raw?.cryptoState).toBe('ROTATION_REQUIRED');
    expect(raw?.roomKeyVersion).toBe(1);
    expect(raw?.membershipRevision).toBe(1);
    const keyObj = raw?.encryptedRoomKeys?.[user1._id.toString()];
    expect(keyObj?.identityVersion).toBe(0);
  });

  it('sets valid verifiable room to ACTIVE', async () => {
    const room = await ChatRoom.create({
      roomId: `valid-${SUFFIX}`,
      roomName: 'Test Valid',
      createdBy: user1._id,
      participants: [user1._id],
      isDM: false,
    });
    createdRoomIds.push(room._id);

    await ChatRoom.collection.updateOne(
      { _id: room._id },
      { $set: { encryptedRoomKeys: { [user1._id.toString()]: { encryptedKey: 'key', identityVersion: 2 } } } }
    );

    await migrate(false);

    const raw = await ChatRoom.collection.findOne({ _id: room._id });
    expect(raw?.cryptoState).toBe('ACTIVE');
  });

  it('performs no writes during dry-run', async () => {
    const room = await ChatRoom.create({
      roomId: `dryrun-${SUFFIX}`,
      roomName: 'Dry Run',
      createdBy: user1._id,
      participants: [user1._id],
      isDM: false,
    });
    createdRoomIds.push(room._id);

    await ChatRoom.collection.updateOne(
      { _id: room._id },
      { $set: { encryptedRoomKeys: { [user1._id.toString()]: 'legacy' } } }
    );
    // Explicitly unset cryptoState
    await ChatRoom.collection.updateOne({ _id: room._id }, { $unset: { cryptoState: '' } });

    await migrate(true); // dry run

    const raw = await ChatRoom.collection.findOne({ _id: room._id });
    expect(raw?.cryptoState).toBeUndefined(); // no changes made
  });

  it('is idempotent on rerun', async () => {
    const room = await ChatRoom.create({
      roomId: `idem-${SUFFIX}`,
      roomName: 'Test Idempotent',
      createdBy: user1._id,
      participants: [user1._id],
      isDM: false,
    });
    createdRoomIds.push(room._id);

    await ChatRoom.collection.updateOne(
      { _id: room._id },
      { $set: { encryptedRoomKeys: { [user1._id.toString()]: { encryptedKey: 'key', identityVersion: 2 } } } }
    );

    await migrate(false);
    const raw1 = await ChatRoom.collection.findOne({ _id: room._id });
    expect(raw1?.cryptoState).toBe('ACTIVE');

    // Rerun
    await migrate(false);
    const raw2 = await ChatRoom.collection.findOne({ _id: room._id });
    expect(raw2?.cryptoState).toBe('ACTIVE');
  });
});
