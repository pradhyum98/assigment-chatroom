import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type {
  OptimisticMutation,
  OptimisticStatus,
} from '../../services/optimisticTypes';
import {
  isSendMutation,
  isEditMutation,
  isDeleteMutation,
  isAddReactionMutation,
  isRemoveReactionMutation,
} from '../../services/optimisticTypes';

export interface Reaction {
  emoji: string;
  userId: string;
  userName?: string;
}

export interface ReadReceipt {
  userId: string;
  readAt: string;
}

export interface DeliveryReceipt {
  userId: string;
  deliveredAt: string;
}

export interface Message {
  messageId: string;
  _id?: string;
  senderId: string;
  senderName: string;
  roomId: string;
  content: string;
  timestamp: string;
  type?: string;
  replyTo?: string;
  editedAt?: string;
  deletedAt?: string;
  deletedForEveryone?: boolean;
  reactions?: Reaction[];
  readBy?: ReadReceipt[];
  deliveredTo?: DeliveryReceipt[];
  clientMsgId?: string;
  decryptedMediaUrl?: string;
  mediaUrl?: string;
  mediaFilename?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  mediaKey?: string;
  mediaIv?: string;
  encryptionVersion?: number;
  wrappedMediaKey?: string;
  mediaKeyIv?: string;
  isOptimistic?: boolean;
  isEdited?: boolean;
  isDeleted?: boolean;
}

export interface ChatState {
  messages: Message[];
  loading: boolean;
  error: string | null;
  typingUsers: Record<string, Record<string, string>>;
  /** Keyed by `clientMsgId ?? mutationId`. Value is a fully-typed OptimisticMutation. */
  optimisticMutations: Record<string, OptimisticMutation>;
}

const initialState: ChatState = {
  messages: [],
  loading: false,
  error: null,
  typingUsers: {},
  optimisticMutations: {},
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setMessages: (state, action: PayloadAction<Message[]>) => {
      state.messages = action.payload;
    },
    addMessage: (state, action: PayloadAction<Message>) => {
      const exists = state.messages.some(m => m.messageId === action.payload.messageId);
      if (!exists) {
        state.messages.push(action.payload);
      }
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearMessages: (state) => {
      state.messages = [];
    },
    setDecryptedMessageContent: (state, action: PayloadAction<{ messageId: string; content: string }>) => {
      const msg = state.messages.find(m => m.messageId === action.payload.messageId);
      if (msg) {
        msg.content = action.payload.content;
      }
    },
    updateMessage: (state, action: PayloadAction<{ messageId: string; _id?: string; content: string; editedAt: string }>) => {
      const msg = state.messages.find(m => m.messageId === action.payload.messageId);
      if (msg) {
        msg.content = action.payload.content;
        msg.editedAt = action.payload.editedAt;
        msg.isEdited = true;
      }
    },
    deleteMessage: (state, action: PayloadAction<{ messageId: string; _id?: string; deletedForEveryone: boolean }>) => {
      if (action.payload.deletedForEveryone) {
        const msg = state.messages.find(m => m.messageId === action.payload.messageId);
        if (msg) {
          msg.deletedForEveryone = true;
          msg.content = '';
          msg.deletedAt = new Date().toISOString();
        }
      } else {
        state.messages = state.messages.filter(m => m.messageId !== action.payload.messageId);
      }
    },
    updateMessageReactions: (state, action: PayloadAction<{ messageId: string; _id?: string; reactions: Reaction[] }>) => {
      const msg = state.messages.find(m => m.messageId === action.payload.messageId);
      if (msg) {
        msg.reactions = action.payload.reactions;
      }
    },
    updateMessageReceipts: (state, action: PayloadAction<{
      messageIds: string[];
      type: 'read' | 'delivered';
      receipt: ReadReceipt | DeliveryReceipt;
    }>) => {
      action.payload.messageIds.forEach(id => {
        const msg = state.messages.find(m => m.messageId === id || m._id === id);
        if (msg) {
          if (action.payload.type === 'read') {
            if (!msg.readBy) msg.readBy = [];
            const r = action.payload.receipt as ReadReceipt;
            if (!msg.readBy.some(x => x.userId === r.userId)) {
              msg.readBy.push(r);
            }
          } else {
            if (!msg.deliveredTo) msg.deliveredTo = [];
            const r = action.payload.receipt as DeliveryReceipt;
            if (!msg.deliveredTo.some(x => x.userId === r.userId)) {
              msg.deliveredTo.push(r);
            }
          }
        }
      });
    },
    setTyping: (state, action: PayloadAction<{ roomId: string; userId: string; userName: string; isTyping: boolean }>) => {
      const { roomId, userId, userName, isTyping } = action.payload;
      if (!state.typingUsers[roomId]) {
        state.typingUsers[roomId] = {};
      }
      if (isTyping) {
        state.typingUsers[roomId][userId] = userName;
      } else {
        delete state.typingUsers[roomId][userId];
      }
    },
    clearTyping: (state) => {
      state.typingUsers = {};
    },

    // ── Optimistic Overlay ────────────────────────────────────────────────────

    /** Bulk-seed from rehydrated outbox (startup recovery). */
    setOptimisticMutations: (state, action: PayloadAction<OptimisticMutation[]>) => {
      state.optimisticMutations = {};
      action.payload.forEach(mut => {
        const key = mut.clientMsgId ?? mut.mutationId;
        state.optimisticMutations[key] = mut;
      });
    },

    /** Add a single mutation immediately after enqueue. */
    addOptimisticMutation: (state, action: PayloadAction<OptimisticMutation>) => {
      const mut = action.payload;
      const key = mut.clientMsgId ?? mut.mutationId;
      state.optimisticMutations[key] = mut;
    },

    /** Remove once canonical event is committed and reconciled. */
    removeOptimisticMutation: (state, action: PayloadAction<string>) => {
      delete state.optimisticMutations[action.payload];
    },

    /** Update status of an existing mutation (e.g., PENDING → SENDING → ACKNOWLEDGED). */
    updateOptimisticMutationStatus: (state, action: PayloadAction<{ key: string; status: OptimisticStatus }>) => {
      const mut = state.optimisticMutations[action.payload.key];
      if (mut) {
        mut.status = action.payload.status;
      }
    },
  },
});

export const {
  setMessages, addMessage, setLoading, setError, clearMessages,
  setDecryptedMessageContent,
  updateMessage, deleteMessage, updateMessageReactions, updateMessageReceipts,
  setTyping, clearTyping,
  setOptimisticMutations, addOptimisticMutation, removeOptimisticMutation, updateOptimisticMutationStatus,
} = chatSlice.actions;

// ── Selectors ─────────────────────────────────────────────────────────────────

export interface RootChatState {
  chat: ChatState;
}

/**
 * Pure deterministic selector.
 * Merges canonical messages with typed optimistic mutations.
 * - SEND_MESSAGE: appended as virtual optimistic message.
 * - EDIT_MESSAGE: overlays content/editedAt on canonical copy.
 * - DELETE_MESSAGE: hides canonical message.
 * - ADD_REACTION / REMOVE_REACTION: overlays reactions.
 * Account isolation: messages are already filtered by roomId; accountId is checked
 * by the fact that each OptimisticMutation carries accountId (caller must pass same).
 */
export const selectVisibleMessages = (state: RootChatState, roomId: string, accountId?: string): Message[] => {
  const canonicalMessages = state.chat.messages.filter(m => m.roomId === roomId);
  const allMutations = Object.values(state.chat.optimisticMutations);

  // Account isolation: if accountId provided, only include mutations for that account
  const roomMutations = allMutations.filter(m =>
    m.roomId === roomId && (accountId == null || m.accountId === accountId)
  );

  // Build working list — mutable shallow copy
  let visible: Message[] = canonicalMessages.map(m => ({ ...m }));

  // Track which canonical messages already have an optimistic overlay applied
  const canonicalIds = new Set(visible.map(m => m.messageId));

  for (const mut of roomMutations) {
    // Skip quarantined / permanently-rejected mutations — do not alter UI
    if (mut.status === 'QUARANTINED' || mut.status === 'PERMANENTLY_REJECTED') {
      continue;
    }

    if (isSendMutation(mut)) {
      const clientKey = mut.clientMsgId ?? mut.mutationId;
      // If canonical version already received (matched by clientMsgId), skip optimistic copy
      const alreadyConfirmed = visible.some(
        m => m.clientMsgId === clientKey || m.messageId === clientKey
      );
      if (!alreadyConfirmed) {
        visible.push({
          messageId: clientKey,
          clientMsgId: clientKey,
          senderId: mut.payload.senderId,
          senderName: mut.payload.senderName,
          roomId: mut.roomId,
          content: mut.payload.displayContent ?? mut.payload.content,
          timestamp: mut.payload.timestamp,
          type: mut.payload.type,
          replyTo: mut.payload.replyTo,
          mediaUrl: mut.payload.mediaUrl,
          mediaFilename: mut.payload.mediaFilename,
          mediaMimeType: mut.payload.mediaMimeType,
          mediaSize: mut.payload.mediaSize,
          mediaKey: (mut.payload as any).mediaKey,
          mediaIv: (mut.payload as any).mediaIv,
          encryptionVersion: (mut.payload as any).encryptionVersion,
          wrappedMediaKey: (mut.payload as any).wrappedMediaKey,
          mediaKeyIv: (mut.payload as any).mediaKeyIv,
          isOptimistic: true,
        });
      }
    } else if (isEditMutation(mut)) {
      const idx = visible.findIndex(
        m => m.messageId === mut.payload.messageId || m._id === mut.payload.messageId
      );
      if (idx !== -1 && canonicalIds.has(visible[idx].messageId)) {
        // Only overlay if not already newer (editedAt comparison)
        const existingEditedAt = visible[idx].editedAt ?? '';
        if (mut.payload.editedAt > existingEditedAt) {
          visible[idx] = {
            ...visible[idx],
            content: mut.payload.content,
            editedAt: mut.payload.editedAt,
            isEdited: true,
          };
        }
      }
    } else if (isDeleteMutation(mut)) {
      if (mut.payload.deletedForEveryone) {
        const idx = visible.findIndex(
          m => m.messageId === mut.payload.messageId || m._id === mut.payload.messageId
        );
        if (idx !== -1) {
          visible[idx] = {
            ...visible[idx],
            deletedForEveryone: true,
            content: '',
            deletedAt: mut.createdAt,
          };
        }
      } else {
        visible = visible.filter(
          m => m.messageId !== mut.payload.messageId && m._id !== mut.payload.messageId
        );
      }
    } else if (isAddReactionMutation(mut)) {
      const idx = visible.findIndex(m => m.messageId === mut.payload.messageId);
      if (idx !== -1) {
        const reactions = [...(visible[idx].reactions ?? [])];
        const alreadyHas = reactions.some(
          r => r.userId === mut.payload.userId && r.emoji === mut.payload.emoji
        );
        if (!alreadyHas) {
          visible[idx] = {
            ...visible[idx],
            reactions: [...reactions, { emoji: mut.payload.emoji, userId: mut.payload.userId }],
          };
        }
      }
    } else if (isRemoveReactionMutation(mut)) {
      const idx = visible.findIndex(m => m.messageId === mut.payload.messageId);
      if (idx !== -1) {
        visible[idx] = {
          ...visible[idx],
          reactions: (visible[idx].reactions ?? []).filter(
            r => !(r.userId === mut.payload.userId && r.emoji === mut.payload.emoji)
          ),
        };
      }
    }
    // MARK_READ, MARK_DELIVERED, PIN, UNPIN — do not alter visible message list
  }

  // Stable deterministic sort by timestamp, then by messageId for tie-breaking
  return visible.sort((a, b) => {
    const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (diff !== 0) return diff;
    return a.messageId < b.messageId ? -1 : 1;
  });
};

export const selectMessageExists = (messages: Message[], id: string): boolean =>
  messages.some(m => m._id === id || m.messageId === id || m.clientMsgId === id);

export default chatSlice.reducer;
