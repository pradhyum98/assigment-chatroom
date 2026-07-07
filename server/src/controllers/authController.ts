import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import {  } from '../middleware/logger';
import { signToken, signAccessToken, signRefreshToken, setRefreshTokenCookie, clearRefreshTokenCookie, verifyToken } from '../utils/auth';
import { mapUserResponse } from '../utils/user';
import { AuthRequest } from '../types';
import { auditLog } from '../utils/auditLogger';
import { getEmailService } from '../services/EmailService';

const signupSchema = z.object({
  firstName: z.string().min(2, 'First name is required (min 2 characters)').max(50),
  lastName: z.string().min(2, 'Last name is required (min 2 characters)').max(50),
  email: z.string().email('Please provide a valid email'),
  password: z.string().min(6, 'Password must be at least 6 letters long'),
  publicKey: z.string().optional(),
  encryptedPrivateKey: z.object({
    ciphertext: z.string(),
    iv: z.string(),
  }).optional(),
});

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required to continue'),
  publicKey: z.string().optional(),
});

export const signup = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { success, data, error } = signupSchema.safeParse(req.body);

    if (!success) {
      throw new AppError(error.errors[0].message, 400);
    }

    const { firstName, lastName, email, password, publicKey, encryptedPrivateKey } = data;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      auditLog.loginFailed(email, req.ip || '', 'Duplicate registration attempt');
      throw new AppError('This email is already registered. Try logging in instead.', 409);
    }

    const user = await User.create({ 
      firstName, 
      lastName, 
      email, 
      password, 
      publicKey, 
      encryptedPrivateKey
    });
    const accessToken = signAccessToken({ userId: user._id.toString(), email: user.email });
    const refreshToken = signRefreshToken({ userId: user._id.toString(), email: user.email });

    setRefreshTokenCookie(res, refreshToken);

    auditLog.registrationSuccess(email, req.ip || '');

    res.status(201).json({
      success: true,
      message: 'Account created!',
      data: {
        token: accessToken,
        user: mapUserResponse(user),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const ip = req.ip || '';
  let attemptedEmail = '';
  try {
    const { success, data, error } = loginSchema.safeParse(req.body);

    if (!success) {
      throw new AppError(error.errors[0].message, 400);
    }

    const { email, password, publicKey } = data;
    attemptedEmail = email;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      auditLog.loginFailed(attemptedEmail, ip, 'Invalid email or password');
      throw new AppError('Incorrect email or password combination.', 401);
    }

    // Update public key if provided (new device login)
    if (publicKey && user.publicKey !== publicKey) {
      user.publicKey = publicKey;
      await user.save();
    }

    const accessToken = signAccessToken({ userId: user._id.toString(), email: user.email });
    const refreshToken = signRefreshToken({ userId: user._id.toString(), email: user.email });

    setRefreshTokenCookie(res, refreshToken);

    auditLog.loginSuccess(email, ip);

    res.status(200).json({
      success: true,
      message: 'Welcome back!',
      data: {
        token: accessToken,
        user: mapUserResponse(user),
      },
    });
  } catch (error) {
    if (attemptedEmail && !(error instanceof AppError)) {
      auditLog.loginFailed(attemptedEmail, ip, 'Error during login process');
    }
    next(error);
  }
};

export const getMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Session not found', 401);
    }

    res.status(200).json({
      success: true,
      message: 'Successfully pulled user profile',
      data: { user: req.user },
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  clearRefreshTokenCookie(res);
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
};

export const refresh = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new AppError('Refresh token is missing.', 401);
    }

    let decodedPayload: any;
    try {
      decodedPayload = verifyToken(refreshToken);
    } catch (err) {
      throw new AppError('Invalid or expired refresh token.', 401);
    }

    const user = await User.findById(decodedPayload.userId);
    if (!user) {
      throw new AppError('User belonging to this token no longer exists.', 401);
    }

    const newAccessToken = signAccessToken({ userId: user._id.toString(), email: user.email });
    const newRefreshToken = signRefreshToken({ userId: user._id.toString(), email: user.email });

    setRefreshTokenCookie(res, newRefreshToken);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully.',
      data: {
        token: newAccessToken,
        user: mapUserResponse(user)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      throw new AppError('New password must be at least 6 characters', 400);
    }

    const user = await User.findById(req.user?._id);
    if (!user) throw new AppError('User not found', 404);

    user.password = newPassword;
    
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password successfully changed and securely re-encrypted.',
    });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      throw new AppError('Please provide an email address', 400);
    }

    const user = await User.findOne({ email });
    if (!user) {
      res.status(200).json({
        success: true,
        message: 'If that email is registered, a password reset link has been sent.',
      });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');

    user.passwordResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    user.passwordResetExpires = new Date(Date.now() + 3600000); // 1 hour expiry

    await user.save();

    const emailService = getEmailService();
    const mailResult = await emailService.sendPasswordResetEmail(user.email, resetToken);

    const responseData: any = {
      success: true,
      message: 'If that email is registered, a password reset link has been sent.',
    };

    const allowDevToken = process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE === 'true';
    if (process.env.NODE_ENV !== 'production' && allowDevToken && mailResult.devResetToken) {
      responseData.devResetToken = mailResult.devResetToken;
    }

    res.status(200).json(responseData);
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      throw new AppError('Token and new password are required', 400);
    }

    if (newPassword.length < 6) {
      throw new AppError('Password must be at least 6 characters', 400);
    }

    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() }
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      throw new AppError('Password reset token is invalid or has expired.', 400);
    }

    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password successfully reset.',
    });
  } catch (error) {
    next(error);
  }
};
