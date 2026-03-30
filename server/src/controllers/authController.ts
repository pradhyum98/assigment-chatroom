import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../middleware/logger';
import { signToken } from '../utils/auth';
import { mapUserResponse } from '../utils/user';
import { AuthRequest } from '../types';

const signupSchema = z.object({
  firstName: z.string().min(2, 'First name is required (min 2 characters)').max(50),
  lastName: z.string().min(2, 'Last name is required (min 2 characters)').max(50),
  email: z.string().email('Please provide a valid email'),
  password: z.string().min(6, 'Password must be at least 6 letters long'),
});

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required to continue'),
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

    const { firstName, lastName, email, password } = data;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError('This email is already registered. Try logging in instead.', 409);
    }

    const user = await User.create({ firstName, lastName, email, password });
    const token = signToken({ userId: user._id.toString(), email: user.email });

    logger.info(`User registration successful for: ${email}`);

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
  try {
    const { success, data, error } = loginSchema.safeParse(req.body);

    if (!success) {
      throw new AppError(error.errors[0].message, 400);
    }

    const { email, password } = data;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      throw new AppError('Incorrect email or password combination.', 401);
    }

    const token = signToken({ userId: user._id.toString(), email: user.email });

    logger.info(`Successful login: ${email}`);

    res.status(200).json({
      success: true,
      message: 'Welcome back!',
      data: {
        token,
        user: mapUserResponse(user),
      },
    });
  } catch (error) {
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
