import jwt from 'jsonwebtoken';
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

export const verifyToken = (token: string): any => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AppError('Server configuration missing', 500);
  return jwt.verify(token, secret);
};
