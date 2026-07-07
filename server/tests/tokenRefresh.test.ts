import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User } from '../src/models/User';
import { refresh } from '../src/controllers/authController';
import { signRefreshToken } from '../src/utils/auth';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('Token Refresh Integration Flow', () => {
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
    await mongoose.disconnect();
  });

  beforeEach(() => {
    req = {
      cookies: {},
      body: {}
    };
    res = {
      cookie: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
  });

  test('refresh rotates tokens when a valid cookie is present', async () => {
    const token = signRefreshToken({ userId: testUser._id.toString(), email: testUser.email });
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
});
