import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User } from '../src/models/User';
import { refresh } from '../src/controllers/authController';
import { signRefreshToken, hashRefreshToken } from '../src/utils/auth';
import { RefreshSession } from '../src/models/RefreshSession';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('Token Refresh Integration Flow', () => {
  let testUser: any;
  let req: any;
  let res: any;
  let next: any;
  let testSessions: any[] = [];

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not defined');
    }
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }

    testUser = await User.create({
      firstName: 'Refresh',
      lastName: 'Tester',
      email: `test_refresh_${Date.now()}@example.com`,
      password: 'mypassword123',
      friends: [],
      privacyLastSeen: 'everyone',
      privacyOnlineStatus: 'everyone'
    });
  });

  afterAll(async () => {
    if (testUser) {
      await User.deleteOne({ _id: testUser._id });
    }
    await RefreshSession.deleteMany({ _id: { $in: testSessions } });
    await mongoose.disconnect();
  });

  beforeEach(() => {
    req = {
      cookies: {},
      body: {},
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

  test('refresh rotates tokens when a valid cookie is present', async () => {
    const tokenId = 'test-token-id-123';
    const familyId = 'test-family-id-123';
    const token = signRefreshToken({ userId: testUser._id.toString(), tokenId, familyId });
    const hash = hashRefreshToken(token);

    const session = await RefreshSession.create({
      userId: testUser._id,
      familyId,
      tokenId,
      tokenHash: hash,
      parentTokenId: null,
      replacedByTokenId: null,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      deviceLabel: 'Test Agent',
      ipAddress: '127.0.0.1'
    });
    testSessions.push(session._id);

    req.cookies.refreshToken = token;

    await refresh(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.cookie).toHaveBeenCalledWith('refreshToken', expect.any(String), expect.any(Object));
    
    const responseJson = res.json.mock.calls[0][0];
    expect(responseJson.success).toBe(true);
    expect(responseJson.data.token).toBeDefined();
    expect(responseJson.data.user).toBeDefined();
    expect(responseJson.data.user.email).toBe(testUser.email);
  });

  test('refresh rejects request with 401 when cookie is missing', async () => {
    await refresh(req, res, next);

    expect(next).toHaveBeenCalled();
    const errorPassed = next.mock.calls[0][0];
    expect(errorPassed.statusCode).toBe(401);
    expect(errorPassed.message).toContain('Refresh token is missing');
  });

  test('refresh rejects request with 401 when cookie is invalid', async () => {
    req.cookies.refreshToken = 'invalid-token-contents-here';

    await refresh(req, res, next);

    expect(next).toHaveBeenCalled();
    const errorPassed = next.mock.calls[0][0];
    expect(errorPassed.statusCode).toBe(401);
    expect(errorPassed.message).toContain('Invalid or expired refresh token');
  });

  test('reusing a refresh token revokes the entire session family', async () => {
    const tokenId1 = 'test-token-id-reuse-1';
    const tokenId2 = 'test-token-id-reuse-2'; // Represents the legitimate new token that was generated from tokenId1
    const familyId = 'test-family-id-reuse';
    
    // Create the old token (simulating it was already used)
    const oldToken = signRefreshToken({ userId: testUser._id.toString(), tokenId: tokenId1, familyId });
    const oldHash = hashRefreshToken(oldToken);

    // Create the new token (simulating the one given to the legitimate client)
    const newToken = signRefreshToken({ userId: testUser._id.toString(), tokenId: tokenId2, familyId });
    const newHash = hashRefreshToken(newToken);

    const oldSession = await RefreshSession.create({
      userId: testUser._id,
      familyId,
      tokenId: tokenId1,
      tokenHash: oldHash,
      parentTokenId: null,
      replacedByTokenId: tokenId2,
      issuedAt: new Date(Date.now() - 10000),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      usedAt: new Date(), // ALREADY USED
      deviceLabel: 'Test Agent',
      ipAddress: '127.0.0.1'
    });
    testSessions.push(oldSession._id);

    const newSession = await RefreshSession.create({
      userId: testUser._id,
      familyId,
      tokenId: tokenId2,
      tokenHash: newHash,
      parentTokenId: tokenId1,
      replacedByTokenId: null,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      deviceLabel: 'Test Agent',
      ipAddress: '127.0.0.1'
    });
    testSessions.push(newSession._id);

    // Attack: Re-use the already used token
    req.cookies.refreshToken = oldToken;
    await refresh(req, res, next);

    expect(next).toHaveBeenCalled();
    const errorPassed = next.mock.calls[0][0];
    expect(errorPassed.statusCode).toBe(401);
    expect(errorPassed.message).toContain('Session revoked due to replay detection.');

    // Verify that the entire family is revoked
    const familySessions = await RefreshSession.find({ familyId });
    expect(familySessions.length).toBe(2);
    familySessions.forEach(s => {
      expect(s.revokedAt).toBeDefined();
      expect(s.revokedAt).not.toBeNull();
    });
  });

  test('concurrent refresh token rotation requests succeed only once (atomicity)', async () => {
    // Generate valid tokens for user
    const familyId = crypto.randomUUID();
    const tokenId1 = crypto.randomUUID();

    const oldToken = signRefreshToken({ userId: testUser._id.toString(), tokenId: tokenId1, familyId });
    const oldHash = hashRefreshToken(oldToken);

    // Create a valid session
    await RefreshSession.create({
      userId: testUser._id,
      familyId,
      tokenId: tokenId1,
      tokenHash: oldHash,
      replacedByTokenId: null,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      deviceLabel: 'Concurrency Tester',
      ipAddress: '127.0.0.1'
    });

    req.cookies.refreshToken = oldToken;
    
    const req1 = { ...req, cookies: { ...req.cookies } };
    const req2 = { ...req, cookies: { ...req.cookies } };

    const res1 = {
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    } as any;

    const res2 = {
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    } as any;

    const next1 = jest.fn();
    const next2 = jest.fn();

    // Fire concurrently
    await Promise.all([
      refresh(req1, res1, next1),
      refresh(req2, res2, next2)
    ]);

    // One must succeed (call json) and one must fail (call next with error)
    const successCount = res1.json.mock.calls.length + res2.json.mock.calls.length;
    const errorCount = next1.mock.calls.length + next2.mock.calls.length;

    expect(successCount).toBe(1);
    expect(errorCount).toBe(1);

    // The error should be 401 Session revoked due to replay detection
    const failedNext = next1.mock.calls.length > 0 ? next1 : next2;
    const errorPassed = failedNext.mock.calls[0][0];
    expect(errorPassed.statusCode).toBe(401);
    expect(errorPassed.message).toContain('Session revoked due to replay detection');
  });
});

