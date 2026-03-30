import { Request as ExpressRequest } from 'express';

export interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPublic {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: Date;
}

export interface ChatRoom {
  _id: string;
  roomId: string;
  roomName: string;
  createdBy: string;
  participants: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  _id: string;
  messageId: string;
  senderId: string;
  senderName: string;
  roomId: string;
  content: string;
  timestamp: Date;
}

/**
 * Extends the default Express Request to include our custom user property.
 */
export interface AuthRequest extends ExpressRequest {
  user?: UserPublic;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
}

// Global declaration to augment Express.Request
declare global {
  namespace Express {
    interface Request {
      user?: UserPublic;
    }
  }
}
