import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { AppError } from '../middleware/errorHandler';

/**
 * Handles JWT generation and verification logic.
 * Centered here for easier maintenance and testing.
 */
export const signToken = (payload: { userId: string; email: string }): string => {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

  if (!secret) {
    throw new AppError('Server is not properly configured (Missing JWT_SECRET)', 500);
  }

  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
};

export const signAccessToken = (payload: { userId: string; email: string }): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError('Server is not properly configured (Missing JWT_SECRET)', 500);
  }
  return jwt.sign(payload, secret, { expiresIn: '15m' });
};

export const signRefreshToken = (payload: { userId: string; email: string }): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError('Server is not properly configured (Missing JWT_SECRET)', 500);
  }
  return jwt.sign(payload, secret, { expiresIn: '7d' });
};

export const verifyToken = (token: string): any => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AppError('Server configuration missing', 500);
  return jwt.verify(token, secret);
};

export const setRefreshTokenCookie = (res: Response, token: string) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in ms
  });
};

export const clearRefreshTokenCookie = (res: Response) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
};
