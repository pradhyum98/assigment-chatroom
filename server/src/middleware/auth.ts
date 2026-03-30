import { Response, NextFunction } from 'express';
import { User } from '../models/User';
import { AppError } from './errorHandler';
import { AuthRequest } from '../types';
import { verifyToken } from '../utils/auth';
import { mapUserResponse } from '../utils/user';

/**
 * Middleware to authenticate requests using JWT.
 * Populates req.user with verified user details.
 */
export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authentication required. Please log in.', 401);
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId).lean();

      if (!user) {
        throw new AppError('User account not found or deactivated.', 401);
      }

      req.user = mapUserResponse(user);
      next();
    } catch (err) {
      throw new AppError('Session expired or invalid. Please log in again.', 401);
    }
  } catch (error) {
    next(error);
  }
};
