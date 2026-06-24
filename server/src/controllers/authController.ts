import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import {  } from '../middleware/logger';
import { signToken } from '../utils/auth';
import { mapUserResponse } from '../utils/user';
import { AuthRequest } from '../types';
import { auditLog } from '../utils/auditLogger';
import { encryptPasswordForRecovery } from '../utils/passwordRecovery';

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

    const encryptedPasswordRecovery = encryptPasswordForRecovery(password);

    const user = await User.create({ 
      firstName, 
      lastName, 
      email, 
      password, 
      publicKey, 
      encryptedPrivateKey,
      encryptedPasswordRecovery
    });
    const token = signToken({ userId: user._id.toString(), email: user.email });

    auditLog.registrationSuccess(email, req.ip || '');

    res.status(201).json({
      success: true,
      message: 'Account created!',
      data: {
        token,
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

    const token = signToken({ userId: user._id.toString(), email: user.email });

    auditLog.loginSuccess(email, ip);

    res.status(200).json({
      success: true,
      message: 'Welcome back!',
      data: {
        token,
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
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
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
    user.encryptedPasswordRecovery = encryptPasswordForRecovery(newPassword);
    
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password successfully changed and securely re-encrypted.',
    });
  } catch (error) {
    next(error);
  }
};
