import { z } from 'zod';
import { CanonicalReconciler } from './CanonicalReconciler';

// ── Event Types ─────────────────────────────────────────────────────────────

export const RoomEventType = {
  MESSAGE_CREATED: 'MESSAGE_CREATED',
  MESSAGE_EDITED: 'MESSAGE_EDITED',
  MESSAGE_DELETED: 'MESSAGE_DELETED',
  REACTION_CHANGED: 'REACTION_CHANGED',
  READ_UPDATED: 'READ_UPDATED',
  DELIVERY_UPDATED: 'DELIVERY_UPDATED',
  ROOM_METADATA_CHANGED: 'ROOM_METADATA_CHANGED',
  MEMBERSHIP_CHANGED: 'MEMBERSHIP_CHANGED',
  ADMIN_CHANGED: 'ADMIN_CHANGED',
  PINNED_MESSAGES_CHANGED: 'PINNED_MESSAGES_CHANGED',
  IDENTITY_CHANGED: 'IDENTITY_CHANGED',
  ROOM_KEY_ROTATION_REQUIRED: 'ROOM_KEY_ROTATION_REQUIRED',
  ROOM_KEY_ROTATED: 'ROOM_KEY_ROTATED'
} as const;
export type RoomEventType = typeof RoomEventType[keyof typeof RoomEventType];

export const UserEventType = {
  ROOM_ACCESS_GRANTED: 'ROOM_ACCESS_GRANTED',
  ROOM_ACCESS_REVOKED: 'ROOM_ACCESS_REVOKED',
  ROOM_DELETED: 'ROOM_DELETED',
  IDENTITY_RESET: 'IDENTITY_RESET',
  SESSION_SECURITY: 'SESSION_SECURITY',
} as const;
export type UserEventType = typeof UserEventType[keyof typeof UserEventType];

// ── Generic Event Envelope ──────────────────────────────────────────────────

export interface RoomEventEnvelope {
  _id?: string;
  roomId: string;
  sequenceNumber: number;
  eventType: RoomEventType;
  eventVersion: number;
  actorId?: string;
  payload: any;
  createdAt: string | Date;
}

export interface UserEventEnvelope {
  _id?: string;
  userId: string;
  sequenceNumber: number;
  eventType: UserEventType;
  eventVersion: number;
  payload: any;
  createdAt: string | Date;
}

// ── Schemas ─────────────────────────────────────────────────────────────────

export const MessageCreatedSchema = z.object({
  message: z.any(),
  clientMsgId: z.string().optional(),
});

export const MessageEditedSchema = z.object({
  messageId: z.string(),
  content: z.string(),
  editedAt: z.string().or(z.date()),
});

export const MessageDeletedSchema = z.object({
  messageId: z.string(),
});

export const ReactionChangedSchema = z.object({
  messageId: z.string(),
  userId: z.string(),
  emoji: z.string(),
  action: z.enum(['add', 'remove']),
});

export const MessagesReadSchema = z.object({
  messageIds: z.array(z.string()),
  userId: z.string(),
  readAt: z.string().or(z.date()),
});

export const MessagesDeliveredSchema = z.object({
  messageIds: z.array(z.string()),
  userId: z.string(),
  deliveredAt: z.string().or(z.date()),
});

export const RoomMetadataChangedSchema = z.object({
  roomName: z.string().optional(),
  description: z.string().optional(),
  avatarColor: z.string().optional(),
});

export const MembershipChangedSchema = z.object({
  userId: z.string(),
  action: z.enum(['joined', 'left', 'added', 'removed']),
  actorId: z.string(),
});

export const AdminChangedSchema = z.object({
  userId: z.string(),
  action: z.enum(['promoted', 'demoted']),
  actorId: z.string(),
});

export const PinnedMessagesChangedSchema = z.object({
  messageId: z.string(),
  action: z.enum(['pinned', 'unpinned']),
  pinnedBy: z.string(),
});

export const IdentityChangedSchema = z.object({
  userId: z.string(),
  identityVersion: z.number(),
  publicKey: z.string(),
});

export const RoomKeyRotationRequiredSchema = z.object({
  reason: z.string().optional(),
  membershipRevision: z.number().optional(),
  roomKeyVersion: z.number().optional(),
});

export const RoomKeyRotatedSchema = z.object({
  roomKeyVersion: z.number(),
  rotatedBy: z.string(),
});

// -- User Event Schemas
export const RoomAccessGrantedSchema = z.object({
  roomId: z.string(),
  membershipRevision: z.number(),
  roomKeyVersion: z.number(),
  encryptedRoomKey: z.string(),
  roomData: z.any().optional(),
});

export const RoomAccessRevokedSchema = z.object({
  roomId: z.string(),
  reason: z.string().optional(),
});

export const RoomDeletedSchema = z.object({
  roomId: z.string(),
});

export const IdentityResetSchema = z.object({
  newIdentityVersion: z.number(),
  timestamp: z.string().or(z.date()),
});

export const SessionSecuritySchema = z.object({
  action: z.enum(['revoked_others', 'device_added']),
  deviceId: z.string().optional(),
});

// ── Registry ────────────────────────────────────────────────────────────────

export type ProjectionHandler<T> = (
  reconciler: CanonicalReconciler,
  event: T,
  payload: any
) => Promise<void>;

export interface ContractDefinition {
  eventType: string;
  eventVersion: number;
  streamType: 'room' | 'user';
  schema: z.ZodSchema<any>;
  handlerName: string;
}

export const EventContractRegistry: Record<string, ContractDefinition> = {
  [RoomEventType.MESSAGE_CREATED]: {
    eventType: RoomEventType.MESSAGE_CREATED,
    eventVersion: 1,
    streamType: 'room',
    schema: MessageCreatedSchema,
    handlerName: 'handleMessageCreated'
  },
  [RoomEventType.MESSAGE_EDITED]: {
    eventType: RoomEventType.MESSAGE_EDITED,
    eventVersion: 1,
    streamType: 'room',
    schema: MessageEditedSchema,
    handlerName: 'handleMessageEdited'
  },
  [RoomEventType.MESSAGE_DELETED]: {
    eventType: RoomEventType.MESSAGE_DELETED,
    eventVersion: 1,
    streamType: 'room',
    schema: MessageDeletedSchema,
    handlerName: 'handleMessageDeleted'
  },
  [RoomEventType.REACTION_CHANGED]: {
    eventType: RoomEventType.REACTION_CHANGED,
    eventVersion: 1,
    streamType: 'room',
    schema: ReactionChangedSchema,
    handlerName: 'handleReactionChanged'
  },
  [RoomEventType.READ_UPDATED]: {
    eventType: RoomEventType.READ_UPDATED,
    eventVersion: 1,
    streamType: 'room',
    schema: MessagesReadSchema,
    handlerName: 'handleReadUpdated'
  },
  [RoomEventType.DELIVERY_UPDATED]: {
    eventType: RoomEventType.DELIVERY_UPDATED,
    eventVersion: 1,
    streamType: 'room',
    schema: MessagesDeliveredSchema,
    handlerName: 'handleDeliveryUpdated'
  },
  [RoomEventType.ROOM_METADATA_CHANGED]: {
    eventType: RoomEventType.ROOM_METADATA_CHANGED,
    eventVersion: 1,
    streamType: 'room',
    schema: RoomMetadataChangedSchema,
    handlerName: 'handleRoomMetadataChanged'
  },
  [RoomEventType.MEMBERSHIP_CHANGED]: {
    eventType: RoomEventType.MEMBERSHIP_CHANGED,
    eventVersion: 1,
    streamType: 'room',
    schema: MembershipChangedSchema,
    handlerName: 'handleMembershipChanged'
  },
  [RoomEventType.ADMIN_CHANGED]: {
    eventType: RoomEventType.ADMIN_CHANGED,
    eventVersion: 1,
    streamType: 'room',
    schema: AdminChangedSchema,
    handlerName: 'handleAdminChanged'
  },
  [RoomEventType.PINNED_MESSAGES_CHANGED]: {
    eventType: RoomEventType.PINNED_MESSAGES_CHANGED,
    eventVersion: 1,
    streamType: 'room',
    schema: PinnedMessagesChangedSchema,
    handlerName: 'handlePinnedMessagesChanged'
  },
  [RoomEventType.IDENTITY_CHANGED]: {
    eventType: RoomEventType.IDENTITY_CHANGED,
    eventVersion: 1,
    streamType: 'room',
    schema: IdentityChangedSchema,
    handlerName: 'handleIdentityChanged'
  },
  [RoomEventType.ROOM_KEY_ROTATION_REQUIRED]: {
    eventType: RoomEventType.ROOM_KEY_ROTATION_REQUIRED,
    eventVersion: 1,
    streamType: 'room',
    schema: RoomKeyRotationRequiredSchema,
    handlerName: 'handleRoomKeyRotationRequired'
  },
  [RoomEventType.ROOM_KEY_ROTATED]: {
    eventType: RoomEventType.ROOM_KEY_ROTATED,
    eventVersion: 1,
    streamType: 'room',
    schema: RoomKeyRotatedSchema,
    handlerName: 'handleRoomKeyRotated'
  },
  [UserEventType.ROOM_ACCESS_GRANTED]: {
    eventType: UserEventType.ROOM_ACCESS_GRANTED,
    eventVersion: 1,
    streamType: 'user',
    schema: RoomAccessGrantedSchema,
    handlerName: 'handleRoomAccessGranted'
  },
  [UserEventType.ROOM_ACCESS_REVOKED]: {
    eventType: UserEventType.ROOM_ACCESS_REVOKED,
    eventVersion: 1,
    streamType: 'user',
    schema: RoomAccessRevokedSchema,
    handlerName: 'handleRoomAccessRevoked'
  },
  [UserEventType.ROOM_DELETED]: {
    eventType: UserEventType.ROOM_DELETED,
    eventVersion: 1,
    streamType: 'user',
    schema: RoomDeletedSchema,
    handlerName: 'handleRoomDeleted'
  },
  [UserEventType.IDENTITY_RESET]: {
    eventType: UserEventType.IDENTITY_RESET,
    eventVersion: 1,
    streamType: 'user',
    schema: IdentityResetSchema,
    handlerName: 'handleIdentityReset'
  },
  [UserEventType.SESSION_SECURITY]: {
    eventType: UserEventType.SESSION_SECURITY,
    eventVersion: 1,
    streamType: 'user',
    schema: SessionSecuritySchema,
    handlerName: 'handleSessionSecurity'
  }
};
