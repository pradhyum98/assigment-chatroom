import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User } from '../src/models/User';
import { RefreshSession } from '../src/models/RefreshSession';
import { resetIdentity } from '../src/controllers/authController';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('Reset Identity Integration Flow', () => {
  let testUser: any;
  let req: any;
  let res: any;
  let next: any;

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not defined');
    }
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
  });

  beforeEach(async () => {
    testUser = await User.create({
      firstName: 'Identity',
      lastName: 'Tester',
      email: `test_identity_${Date.now()}@example.com`,
      password: 'mypassword123',
      publicKey: 'old-public-key',
      encryptedPrivateKey: { ciphertext: 'old-cipher', iv: 'old-iv' },
      identityVersion: 1,
      friends: [],
      privacyLastSeen: 'everyone',
      privacyOnlineStatus: 'everyone'
    });

    req = {
      user: { _id: testUser._id.toString() },
      body: {
        publicKey: 'new-public-key',
        encryptedPrivateKey: { ciphertext: 'new-cipher', iv: 'new-iv' }
      },
      headers: { 'user-agent': 'Test Agent' },
      ip: '127.0.0.1'
    };

    res = {
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    
    next = jest.fn();
  });

  afterEach(async () => {
    if (testUser) {
      await User.deleteOne({ _id: testUser._id });
      await RefreshSession.deleteMany({ userId: testUser._id });
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  test('resetIdentity updates keys, increments identityVersion, and revokes sessions', async () => {
    // Create a refresh session to test revocation
    await RefreshSession.create({
      userId: testUser._id,
      familyId: 'test-family-123',
      tokenId: 'test-token-123',
      tokenHash: 'hashed-token',
      parentTokenId: null,
      replacedByTokenId: null,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      deviceLabel: 'Test Agent',
      ipAddress: '127.0.0.1'
    });

    await resetIdentity(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const responseJson = res.json.mock.calls[0][0];
    expect(responseJson.success).toBe(true);
    expect(responseJson.data.user.identityVersion).toBe(2);

    // Verify DB state
    const updatedUser = await User.findById(testUser._id);
    expect(updatedUser?.publicKey).toBe('new-public-key');
    expect(updatedUser?.identityVersion).toBe(2);

    // Verify session revocation
    const sessions = await RefreshSession.find({ userId: testUser._id });
    expect(sessions.length).toBe(1);
    expect(sessions[0].revokedAt).toBeDefined();
    expect(sessions[0].revokedAt).not.toBeNull();
  });

  test('resetIdentity requires authentication', async () => {
    req.user = undefined; // No user in request

    await resetIdentity(req, res, next);

    expect(next).toHaveBeenCalled();
    const errorPassed = next.mock.calls[0][0];
    expect(errorPassed.statusCode).toBe(401);
  });
});
