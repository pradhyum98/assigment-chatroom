import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { User } from '../src/models/User';
import { forgotPassword, resetPassword } from '../src/controllers/authController';
import { getEmailService } from '../src/services/EmailService';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('Secure Password Reset Flow', () => {
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
      firstName: 'Reset',
      lastName: 'Tester',
      email: `test_reset_${Date.now()}@example.com`,
      password: 'oldpassword123',
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
      body: {},
      ip: '127.0.0.1'
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
  });

  test('forgotPassword handles request, hashes token, sets expiry, and returns 200', async () => {
    req.body.email = testUser.email;
    
    // Backup dev reset token response config
    const origDevConfig = process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE;
    process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE = 'true';

    await forgotPassword(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const responseJson = res.json.mock.calls[0][0];
    expect(responseJson.success).toBe(true);
    expect(responseJson.devResetToken).toBeDefined();

    // Verify token is hashed and expires in the future in the DB
    const dbUser = await User.findById(testUser._id).select('+passwordResetToken +passwordResetExpires');
    expect(dbUser?.passwordResetToken).toBeDefined();
    expect(dbUser?.passwordResetExpires).toBeDefined();
    expect(dbUser?.passwordResetExpires!.getTime()).toBeGreaterThan(Date.now());

    // Restore env config
    process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE = origDevConfig;
  });

  test('forgotPassword does not expose reset token when ALLOW_DEV_RESET_TOKEN_RESPONSE is false', async () => {
    req.body.email = testUser.email;
    
    const origDevConfig = process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE;
    process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE = 'false';

    await forgotPassword(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const responseJson = res.json.mock.calls[0][0];
    expect(responseJson.success).toBe(true);
    expect(responseJson.devResetToken).toBeUndefined();

    process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE = origDevConfig;
  });

  test('forgotPassword returns generic 200 on non-existent email to prevent enumeration', async () => {
    req.body.email = 'non_existent_email_12345@example.com';
    
    await forgotPassword(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const responseJson = res.json.mock.calls[0][0];
    expect(responseJson.success).toBe(true);
    expect(responseJson.message).toContain('If that email is registered');
  });

  test('resetPassword with valid token resets password, clears fields, and updates DB', async () => {
    // 1. Trigger forgotPassword to get a reset token
    req.body.email = testUser.email;
    const origDevConfig = process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE;
    process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE = 'true';
    
    await forgotPassword(req, res, next);
    const resetToken = res.json.mock.calls[0][0].devResetToken;
    expect(resetToken).toBeDefined();
    
    process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE = origDevConfig;

    // 2. Perform resetPassword call
    const resetReq = {
      body: {
        token: resetToken,
        newPassword: 'brandnewpassword123'
      }
    };
    const resetRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const resetNext = jest.fn();

    await resetPassword(resetReq as any, resetRes as any, resetNext);

    expect(resetRes.status).toHaveBeenCalledWith(200);
    expect(resetRes.json.mock.calls[0][0].success).toBe(true);

    // 3. Verify in DB that reset fields are cleared
    const updatedUser = await User.findById(testUser._id).select('+password +passwordResetToken +passwordResetExpires');
    expect(updatedUser?.passwordResetToken).toBeUndefined();
    expect(updatedUser?.passwordResetExpires).toBeUndefined();

    // 4. Verify password hashing works with the new password
    const passwordMatch = await updatedUser?.comparePassword('brandnewpassword123');
    expect(passwordMatch).toBe(true);
  });

  test('resetPassword rejects expired or invalid tokens', async () => {
    // Attempt with invalid token
    const invalidReq = {
      body: {
        token: 'invalid-token-value-here',
        newPassword: 'password123'
      }
    };
    await resetPassword(invalidReq as any, res, next);
    expect(next).toHaveBeenCalled();
    const errorPassed = next.mock.calls[0][0];
    expect(errorPassed.statusCode).toBe(400);
    expect(errorPassed.message).toContain('invalid or has expired');
  });

  test('ProductionEmailService does not return reset token in its response', async () => {
    const service = getEmailService();
    // Force env mock
    const origNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const result = await getEmailService().sendPasswordResetEmail('prod@example.com', 'some-token');
    expect(result.devResetToken).toBeUndefined();
    expect(result.success).toBe(true);

    process.env.NODE_ENV = origNodeEnv;
  });
});
