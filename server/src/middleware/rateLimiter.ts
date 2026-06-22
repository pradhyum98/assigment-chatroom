import rateLimit from 'express-rate-limit';
import { AppError } from './errorHandler';
import { logger } from './logger';

/**
 * Custom handler to log rate-limit violations and throw standard AppError
 */
const limitHandler = (limiterName: string) => {
  return (req: any, res: any, next: any, options: any) => {
    logger.warn(`Rate limit exceeded for [${limiterName}] from IP: ${req.ip}. URI: ${req.originalUrl}`);
    next(new AppError('Too many requests. Please try again later.', 429));
  };
};

// Strict rate limit for authentication routes (login / register)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler('Authentication'),
});

// Moderate rate limit for searching users
export const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler('Search'),
});

// Rate limit for sensitive request operations (friend requests, DM creation)
export const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler('Request Operations'),
});

// General rate limit for standard REST API endpoints
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler('General API'),
});
