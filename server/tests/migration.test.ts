import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User } from '../src/models/User';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('Legacy Password Recovery Removal Migration', () => {
  let testUsers: any[] = [];

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not defined');
    }
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    // Create test users with the legacy field explicitly set
    testUsers.push(
      await User.create({
        firstName: 'Migrate1',
        lastName: 'Tester',
        email: `test_mig1_${Date.now()}@example.com`,
        password: 'mypassword123',
        friends: [],
        privacyLastSeen: 'everyone',
        privacyOnlineStatus: 'everyone',
        encryptedPasswordRecovery: {
          ciphertext: 'mock-cipher-1',
          iv: 'mock-iv-1',
          authTag: 'mock-tag-1',
          version: 1
        }
      })
    );

    testUsers.push(
      await User.create({
        firstName: 'Migrate2',
        lastName: 'Tester',
        email: `test_mig2_${Date.now()}@example.com`,
        password: 'mypassword123',
        friends: [],
        privacyLastSeen: 'everyone',
        privacyOnlineStatus: 'everyone',
        encryptedPasswordRecovery: {
          ciphertext: 'mock-cipher-2',
          iv: 'mock-iv-2',
          authTag: 'mock-tag-2',
          version: 1
        }
      })
    );
  });

  afterAll(async () => {
    for (const u of testUsers) {
      await User.deleteOne({ _id: u._id });
    }
    await mongoose.disconnect();
  });

  test('successfully removes encryptedPasswordRecovery field from all user documents', async () => {
    // 1. Verify fields exist in the database initially
    for (const u of testUsers) {
      const dbUser = await User.findById(u._id).select('+encryptedPasswordRecovery');
      expect(dbUser?.encryptedPasswordRecovery).toBeDefined();
      expect(dbUser?.encryptedPasswordRecovery?.ciphertext).toBeDefined();
    }

    // 2. Perform the migration query
    const result = await User.updateMany(
      {},
      { $unset: { encryptedPasswordRecovery: 1 } }
    );

    expect(result.matchedCount).toBeGreaterThanOrEqual(2);

    // 3. Verify fields have been completely unset
    for (const u of testUsers) {
      const dbUser = await User.findById(u._id).select('+encryptedPasswordRecovery');
      expect(dbUser?.encryptedPasswordRecovery).toBeUndefined();
    }
  });
});
