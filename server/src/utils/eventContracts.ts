import { z } from 'zod';
import { RoomEventType } from '../models/RoomEvent';
import { UserEventType } from '../models/UserEvent';

// ── Room Events ──────────────────────────────────────────────────────────────

export const MessageCreatedSchema = z.object({
  message: z.any(), // The full message document
  clientMsgId: z.string().optional(),
});

export const MessageEditedSchema = z.object({
  messageId: z.string(),
  content: z.string(), // E2EE encrypted ciphertext
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
  userId: z.string().optional(),
  memberId: z.string().optional(),
  memberIds: z.array(z.string()).optional(),
  action: z.enum(['joined', 'left', 'added', 'removed', 'JOINED', 'LEFT', 'ADDED', 'REMOVED']),
  actorId: z.string().optional(),
  membershipRevision: z.number().optional(),
});

export const AdminChangedSchema = z.object({
  userId: z.string().optional(),
  memberId: z.string().optional(),
  action: z.enum(['promoted', 'demoted', 'PROMOTED', 'DEMOTED']),
  actorId: z.string().optional(),
});

export const PinnedMessagesChangedSchema = z.object({
  messageId: z.string(),
  action: z.enum(['pinned', 'unpinned']),
  actorId: z.string(),
});

export const IdentityChangedSchema = z.object({
  userId: z.string(),
  previousIdentityVersion: z.number().optional(),
  newIdentityVersion: z.number(),
  identityVersion: z.number().optional(),
  publicKey: z.string().optional(),
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

export const RoomEventRegistry: Record<RoomEventType, z.ZodTypeAny> = {
  [RoomEventType.MESSAGE_CREATED]: MessageCreatedSchema,
  [RoomEventType.MESSAGE_EDITED]: MessageEditedSchema,
  [RoomEventType.MESSAGE_DELETED]: MessageDeletedSchema,
  [RoomEventType.REACTION_CHANGED]: ReactionChangedSchema,
  [RoomEventType.READ_UPDATED]: MessagesReadSchema,
  [RoomEventType.DELIVERY_UPDATED]: MessagesDeliveredSchema,
  [RoomEventType.ROOM_METADATA_CHANGED]: RoomMetadataChangedSchema,
  [RoomEventType.MEMBERSHIP_CHANGED]: MembershipChangedSchema,
  [RoomEventType.ADMIN_CHANGED]: AdminChangedSchema,
  [RoomEventType.PINNED_MESSAGES_CHANGED]: PinnedMessagesChangedSchema,
  [RoomEventType.IDENTITY_CHANGED]: IdentityChangedSchema,
  [RoomEventType.ROOM_KEY_ROTATION_REQUIRED]: RoomKeyRotationRequiredSchema,
  [RoomEventType.ROOM_KEY_ROTATED]: RoomKeyRotatedSchema,
};

// ── User Events ──────────────────────────────────────────────────────────────

export const RoomAccessGrantedSchema = z.object({
  roomId: z.string(),
  roomKeyVersion: z.number(),
});

export const RoomAccessRevokedSchema = z.object({
  roomId: z.string(),
});

export const RoomDeletedSchema = z.object({
  roomId: z.string(),
});

export const IdentityResetSchema = z.object({
  newIdentityVersion: z.number(),
});

export const SessionSecuritySchema = z.object({
  action: z.string(),
  reason: z.string().optional(),
});

export const UserEventRegistry: Record<UserEventType, z.ZodTypeAny> = {
  [UserEventType.ROOM_ACCESS_GRANTED]: RoomAccessGrantedSchema,
  [UserEventType.ROOM_ACCESS_REVOKED]: RoomAccessRevokedSchema,
  [UserEventType.ROOM_DELETED]: RoomDeletedSchema,
  [UserEventType.IDENTITY_RESET]: IdentityResetSchema,
  [UserEventType.SESSION_SECURITY]: SessionSecuritySchema,
};

export const validateRoomEventPayload = (eventType: RoomEventType, payload: any) => {
  const schema = RoomEventRegistry[eventType];
  if (!schema) throw new Error(`Unknown RoomEventType: ${eventType}`);
  return schema.parse(payload); // Throws ZodError if invalid
};

export const validateUserEventPayload = (eventType: UserEventType, payload: any) => {
  const schema = UserEventRegistry[eventType];
  if (!schema) throw new Error(`Unknown UserEventType: ${eventType}`);
  return schema.parse(payload); // Throws ZodError if invalid
};
