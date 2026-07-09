/**
 * Strict discriminated union for all client-side optimistic mutations.
 * No `any` permitted. Every variant must carry the 5 base fields.
 */

// ── Base ─────────────────────────────────────────────────────────────────────

export type OptimisticStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'REENCRYPT_REQUIRED'
  | 'SENDING'
  | 'ACKNOWLEDGED'
  | 'RETRYABLE_FAILURE'
  | 'PERMANENTLY_REJECTED'
  | 'QUARANTINED';

interface MutationBase {
  mutationId: string;       // stable ID for deduplication
  clientMsgId?: string;     // set for SEND_MESSAGE only (ties to message render key)
  accountId: string;
  roomId: string;
  createdAt: string;        // ISO-8601
  status: OptimisticStatus;
}

// ── Operation-Specific Payloads ───────────────────────────────────────────────

export interface SendMessagePayload {
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'voice';
  iv?: string;
  replyTo?: string;
  mediaUrl?: string;
  mediaFilename?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  wrappedMediaKey?: string;
  mediaKeyIv?: string;
  mediaIv?: string;
  encryptionVersion?: 1 | 2;
}

export interface EditMessagePayload {
  messageId: string;
  content: string;
  editedAt: string;
  iv?: string;
}

export interface DeleteMessagePayload {
  messageId: string;
  deletedForEveryone: boolean;
}

export interface AddReactionPayload {
  messageId: string;
  emoji: string;
  userId: string;
}

export interface RemoveReactionPayload {
  messageId: string;
  emoji: string;
  userId: string;
}

export interface MarkReadPayload {
  messageIds: string[];
}

export interface MarkDeliveredPayload {
  messageIds: string[];
}

export interface PinMessagePayload {
  messageId: string;
}

export interface UnpinMessagePayload {
  messageId: string;
}

// ── Tagged Variants ───────────────────────────────────────────────────────────

export interface SendMessageMutation extends MutationBase {
  actionType: 'SEND_MESSAGE';
  payload: SendMessagePayload;
}

export interface EditMessageMutation extends MutationBase {
  actionType: 'EDIT_MESSAGE';
  payload: EditMessagePayload;
}

export interface DeleteMessageMutation extends MutationBase {
  actionType: 'DELETE_MESSAGE';
  payload: DeleteMessagePayload;
}

export interface AddReactionMutation extends MutationBase {
  actionType: 'ADD_REACTION';
  payload: AddReactionPayload;
}

export interface RemoveReactionMutation extends MutationBase {
  actionType: 'REMOVE_REACTION';
  payload: RemoveReactionPayload;
}

export interface MarkReadMutation extends MutationBase {
  actionType: 'MARK_READ';
  payload: MarkReadPayload;
}

export interface MarkDeliveredMutation extends MutationBase {
  actionType: 'MARK_DELIVERED';
  payload: MarkDeliveredPayload;
}

export interface PinMessageMutation extends MutationBase {
  actionType: 'PIN_MESSAGE';
  payload: PinMessagePayload;
}

export interface UnpinMessageMutation extends MutationBase {
  actionType: 'UNPIN_MESSAGE';
  payload: UnpinMessagePayload;
}

/** The full discriminated union */
export type OptimisticMutation =
  | SendMessageMutation
  | EditMessageMutation
  | DeleteMessageMutation
  | AddReactionMutation
  | RemoveReactionMutation
  | MarkReadMutation
  | MarkDeliveredMutation
  | PinMessageMutation
  | UnpinMessageMutation;

export type OptimisticActionType = OptimisticMutation['actionType'];

// ── Type Guards ───────────────────────────────────────────────────────────────

export const isSendMutation = (m: OptimisticMutation): m is SendMessageMutation =>
  m.actionType === 'SEND_MESSAGE';

export const isEditMutation = (m: OptimisticMutation): m is EditMessageMutation =>
  m.actionType === 'EDIT_MESSAGE';

export const isDeleteMutation = (m: OptimisticMutation): m is DeleteMessageMutation =>
  m.actionType === 'DELETE_MESSAGE';

export const isAddReactionMutation = (m: OptimisticMutation): m is AddReactionMutation =>
  m.actionType === 'ADD_REACTION';

export const isRemoveReactionMutation = (m: OptimisticMutation): m is RemoveReactionMutation =>
  m.actionType === 'REMOVE_REACTION';
