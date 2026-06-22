import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AppError } from './errorHandler';
import { logger } from './logger';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Middleware to validate that a specific parameter is a valid MongoDB ObjectId
 */
export const validateObjectId = (parameterName: string) => {
  return (req: any, res: Response, next: NextFunction) => {
    const value = req.params[parameterName] || req.body[parameterName] || req.query[parameterName];
    if (value && !mongoose.Types.ObjectId.isValid(value)) {
      logger.warn(`ObjectId validation failed for key: "${parameterName}" (Value: ${value})`);
      return next(new AppError('Invalid ID format provided.', 400));
    }
    next();
  };
};

/**
 * Middleware to validate that a specific parameter is a valid UUIDv4 format
 */
export const validateUuid = (parameterName: string) => {
  return (req: any, res: Response, next: NextFunction) => {
    const value = req.params[parameterName] || req.body[parameterName] || req.query[parameterName];
    if (value && !uuidRegex.test(value)) {
      logger.warn(`UUID validation failed for key: "${parameterName}" (Value: ${value})`);
      return next(new AppError('Invalid resource room ID format.', 400));
    }
    next();
  };
};

/**
 * Traverses request objects to search for keys containing MongoDB operators (starting with $)
 * and blocks any payload structures that are not primitive values where primitive is expected.
 */
const hasNoSqlOperators = (obj: any): boolean => {
  if (!obj || typeof obj !== 'object') return false;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      return true;
    }
    if (typeof obj[key] === 'object' && hasNoSqlOperators(obj[key])) {
      return true;
    }
  }
  return false;
};

/**
 * Middleware to block NoSQL injection queries
 */
export const preventNoSqlInjection = (req: any, res: Response, next: NextFunction) => {
  if (
    hasNoSqlOperators(req.body) ||
    hasNoSqlOperators(req.query) ||
    hasNoSqlOperators(req.params)
  ) {
    logger.warn(`Suspicious NoSQL query blocked from IP: ${req.ip}`);
    return next(new AppError('Invalid characters or queries detected in input.', 400));
  }
  next();
};

/**
 * Middleware to strip HTML tags and dangerous protocol URLs from message content
 * to protect against XSS in stored messages.
 */
export const sanitizeMessage = (req: any, res: Response, next: NextFunction) => {
  if (req.body && typeof req.body.content === 'string') {
    // Strip HTML tags
    let sanitized = req.body.content.replace(/<[^>]*>/g, '');

    // Strip dangerous protocol references (javascript:, vbscript:, data:, etc.)
    sanitized = sanitized.replace(/\b(javascript|vbscript|data|blob):/gi, '');

    req.body.content = sanitized;

    // Check size limit: max 2000 characters
    if (req.body.content.length > 2000) {
      return next(new AppError('Message is too long. Maximum allowed size is 2000 characters.', 400));
    }
  }
  next();
};
