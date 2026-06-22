import { Request as ExpressRequest } from 'express';

// ─── User types ───────────────────────────────────────────────────────────────

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
  friends: string[];

  // Presence
  lastSeen?: Date;
  isOnline?: boolean;

  // Profile
  avatar?: string;
  bio?: string;
  statusMessage?: string;

  createdAt: Date;
}

// ─── Room types ───────────────────────────────────────────────────────────────

export interface ChatRoom {
  _id: string;
  roomId: string;
  roomName?: string;
  avatarColor?: string;
  avatarUrl?: string;
  previewText?: string;
  description?: string;
  createdBy: string;
  participants: string[];
  admins: string[];
  isDM: boolean;
  isPrivate: boolean;
  lastMessage?: string;
  pinnedMessages: string[];
  unreadCounts: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Message types ─────────────────────────────────────────────────────────────

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'voice';

export interface MessageReaction {
  emoji: string;
  userId: string;
  createdAt: Date;
}

export interface ReadReceipt {
  userId: string;
  readAt: Date;
}

export interface DeliveryReceipt {
  userId: string;
  deliveredAt: Date;
}

export interface Message {
  _id: string;
  messageId: string;
  senderId: string;
  senderName: string;
  roomId: string;

  type: MessageType;
  content: string;
  timestamp: Date;

  // Media
  mediaUrl?: string;
  mediaFilename?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  thumbnailUrl?: string;

  // Threading
  replyTo?: string;

  // Edit / delete
  editedAt?: Date;
  deletedAt?: Date;
  deletedForEveryone: boolean;

  // Reactions & receipts
  reactions: MessageReaction[];
  deliveredTo: DeliveryReceipt[];
  readBy: ReadReceipt[];
}

// ─── Request / response types ─────────────────────────────────────────────────

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
