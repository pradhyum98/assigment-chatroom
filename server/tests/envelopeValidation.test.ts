import mongoose from 'mongoose';
import { validateRoomEnvelopes } from '../src/utils/envelopeValidation';
import { User } from '../src/models/User';
import connectDB from '../src/config/db';
import dotenv from 'dotenv';
dotenv.config();

describe('Envelope Validation Module', () => {
  let user1: any, user2: any;
  const suffix = Date.now();

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await User.deleteMany({ email: { $regex: /@envelope-test\.com$/ } });
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Delete previous iteration's users if they exist
    await User.deleteMany({ email: { $in: [`u1-${suffix}@envelope-test.com`, `u2-${suffix}@envelope-test.com`] } });
    user1 = await User.create({
      firstName: 'U1', lastName: 'L1', email: `u1-${suffix}@envelope-test.com`, password: 'password', identityVersion: 2,
    });
    user2 = await User.create({
      firstName: 'U2', lastName: 'L2', email: `u2-${suffix}@envelope-test.com`, password: 'password', identityVersion: 1,
    });
  });

  afterEach(async () => {
    await User.deleteMany({ _id: { $in: [user1?._id, user2?._id].filter(Boolean) } });
  });

  it('validates a correct envelope set', async () => {
    const participants = [user1._id, user2._id];
    const envelopes = {
      [user1._id.toString()]: { encryptedKey: 'key1', identityVersion: 2 },
      [user2._id.toString()]: { encryptedKey: 'key2', identityVersion: 1 },
    };
    await expect(validateRoomEnvelopes(participants, envelopes)).resolves.toBeUndefined();
  });

  it('throws on missing envelope', async () => {
    const participants = [user1._id, user2._id];
    const envelopes = {
      [user1._id.toString()]: { encryptedKey: 'key1', identityVersion: 2 },
    };
    await expect(validateRoomEnvelopes(participants, envelopes)).rejects.toThrow(/Missing envelopes for users/);
  });

  it('throws on extra envelope', async () => {
    const participants = [user1._id];
    const envelopes = {
      [user1._id.toString()]: { encryptedKey: 'key1', identityVersion: 2 },
      [user2._id.toString()]: { encryptedKey: 'key2', identityVersion: 1 },
    };
    await expect(validateRoomEnvelopes(participants, envelopes)).rejects.toThrow(/Extra envelopes provided for non-participants/);
  });

  it('throws on stale identity version', async () => {
    const participants = [user1._id, user2._id];
    const envelopes = {
      [user1._id.toString()]: { encryptedKey: 'key1', identityVersion: 1 }, // Stale! Current is 2
      [user2._id.toString()]: { encryptedKey: 'key2', identityVersion: 1 },
    };
    await expect(validateRoomEnvelopes(participants, envelopes)).rejects.toThrow(/Stale or future identity version for user/);
  });

  it('throws on future identity version', async () => {
    const participants = [user1._id, user2._id];
    const envelopes = {
      [user1._id.toString()]: { encryptedKey: 'key1', identityVersion: 3 }, // Future! Current is 2
      [user2._id.toString()]: { encryptedKey: 'key2', identityVersion: 1 },
    };
    await expect(validateRoomEnvelopes(participants, envelopes)).rejects.toThrow(/Stale or future identity version for user/);
  });

  it('throws on malformed envelope', async () => {
    const participants = [user1._id];
    const envelopes: any = {
      [user1._id.toString()]: { encryptedKey: 'key1' }, // Missing identityVersion
    };
    await expect(validateRoomEnvelopes(participants, envelopes)).rejects.toThrow(/Malformed envelope for user/);
  });

  it('throws on unknown user', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const participants = [fakeId];
    const envelopes = {
      [fakeId.toString()]: { encryptedKey: 'key1', identityVersion: 1 },
    };
    await expect(validateRoomEnvelopes(participants, envelopes)).rejects.toThrow(/could not be found/);
  });
});
