import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
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

import crypto from 'crypto';

export const hashRefreshToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const signRefreshToken = (payload: { userId: string; tokenId: string; familyId: string }): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError('Server is not properly configured (Missing JWT_SECRET)', 500);
  }
  return jwt.sign(payload, secret, { expiresIn: '30d' });
};

export const verifyToken = (token: string): any => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AppError('Server configuration missing', 500);
  return jwt.verify(token, secret);
};

export const setRefreshTokenCookie = (req: Request, res: Response, token: string) => {
  const origin = req.headers.origin;
  const isCapacitor = origin && (origin.startsWith('capacitor://') || origin.startsWith('https://localhost') || origin.startsWith('http://localhost'));

  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: isCapacitor ? false : (process.env.NODE_ENV === 'production'),
    sameSite: isCapacitor ? 'lax' : 'strict',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days in ms
  });
};

export const clearRefreshTokenCookie = (req: Request, res: Response) => {
  const origin = req.headers.origin;
  const isCapacitor = origin && (origin.startsWith('capacitor://') || origin.startsWith('https://localhost') || origin.startsWith('http://localhost'));

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: isCapacitor ? false : (process.env.NODE_ENV === 'production'),
    sameSite: isCapacitor ? 'lax' : 'strict',
    path: '/api/auth'
  });
};
