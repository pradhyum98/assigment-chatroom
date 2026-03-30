import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

/**
 * Standard request logging middleware for observability.
 * Captures method, URL, and completion status.
 */
export const requestLogger = (req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.url}`);
  next();
};
