import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface Message {
  messageId: string;
  _id?: string;
  senderId: string;
  senderName: string;
  roomId: string;
  content: string;
  timestamp: string;
  type?: string;
  replyTo?: any;
  editedAt?: string;
  deletedAt?: string;
  deletedForEveryone?: boolean;
  reactions?: any[];
  readBy?: any[];
  deliveredTo?: any[];
  clientMsgId?: string;
  decryptedMediaUrl?: string;
  mediaUrl?: string;
  mediaFilename?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  mediaKey?: string;
  mediaIv?: string;
  isOptimistic?: boolean;
}

interface ChatState {
  messages: Message[];
  loading: boolean;
  error: string | null;
  typingUsers: Record<string, Record<string, string>>; // roomId -> { userId -> userName }
}

const initialState: ChatState = {
  messages: [],
  loading: false,
  error: null,
  typingUsers: {},
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
    updateMessage: (state, action: PayloadAction<{ messageId: string;
  _id?: string; content: string; editedAt: string }>) => {
      const msg = state.messages.find(m => m.messageId === action.payload.messageId);
      if (msg) {
        msg.content = action.payload.content;
        msg.editedAt = action.payload.editedAt;
      }
    },
    deleteMessage: (state, action: PayloadAction<{ messageId: string;
  _id?: string; deletedForEveryone: boolean }>) => {
      if (action.payload.deletedForEveryone) {
        const msg = state.messages.find(m => m.messageId === action.payload.messageId);
        if (msg) {
          msg.deletedForEveryone = true;
          msg.content = '';
          msg.deletedAt = new Date().toISOString();
        }
      } else {
        // Soft delete for me - just remove from UI
        state.messages = state.messages.filter(m => m.messageId !== action.payload.messageId);
      }
    },
    updateMessageReactions: (state, action: PayloadAction<{ messageId: string;
  _id?: string; reactions: any[] }>) => {
      const msg = state.messages.find(m => m.messageId === action.payload.messageId);
      if (msg) {
        msg.reactions = action.payload.reactions;
      }
    },
    updateMessageReceipts: (state, action: PayloadAction<{ messageIds: string[]; type: 'read' | 'delivered'; receipt: any }>) => {
      action.payload.messageIds.forEach(id => {
        const msg = state.messages.find(m => m.messageId === id || m._id === id); // _id handles mongoose id if messageId fails
        if (msg) {
          if (action.payload.type === 'read') {
            if (!msg.readBy) msg.readBy = [];
            // Prevent duplicate
            if (!msg.readBy.some(r => r.userId === action.payload.receipt.userId)) {
              msg.readBy.push(action.payload.receipt);
            }
          } else if (action.payload.type === 'delivered') {
            if (!msg.deliveredTo) msg.deliveredTo = [];
            if (!msg.deliveredTo.some(r => r.userId === action.payload.receipt.userId)) {
              msg.deliveredTo.push(action.payload.receipt);
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
    upsertMessage: (state, action: PayloadAction<Message>) => {
      const newMsg = action.payload;
      const idx = state.messages.findIndex(m => 
        (newMsg._id && m._id === newMsg._id) || 
        (newMsg.messageId && m.messageId === newMsg.messageId) ||
        (newMsg.clientMsgId && m.clientMsgId === newMsg.clientMsgId)
      );
      if (idx !== -1) {
        state.messages[idx] = {
          ...state.messages[idx],
          ...newMsg,
          isOptimistic: newMsg.isOptimistic ?? state.messages[idx].isOptimistic
        };
      } else {
        state.messages.push(newMsg);
      }
    },
    reconcileConfirmedMessage: (state, action: PayloadAction<{ clientMsgId: string; serverMessage: Message }>) => {
      const idx = state.messages.findIndex(m => m.clientMsgId === action.payload.clientMsgId);
      if (idx !== -1) {
        state.messages[idx] = {
          ...action.payload.serverMessage,
          isOptimistic: false
        };
      } else {
        const serverMsg = action.payload.serverMessage;
        const exists = state.messages.some(m => m._id === serverMsg._id || m.messageId === serverMsg.messageId);
        if (!exists) {
          state.messages.push({
            ...serverMsg,
            isOptimistic: false
          });
        }
      }
    },
    confirmMessageSent: (state, action: PayloadAction<{ clientMsgId: string; serverMessage: Message }>) => {
      const idx = state.messages.findIndex(m => m.clientMsgId === action.payload.clientMsgId);
      if (idx !== -1) {
        state.messages[idx] = action.payload.serverMessage;
      }
    }
  },
});

export const { 
  setMessages, addMessage, setLoading, setError, clearMessages,
  updateMessage, deleteMessage, updateMessageReactions, updateMessageReceipts,
  setTyping, clearTyping, confirmMessageSent, upsertMessage, reconcileConfirmedMessage
} = chatSlice.actions;

export const selectMessageExists = (messages: Message[], id: string): boolean => 
  messages.some(m => m._id === id || m.messageId === id || m.clientMsgId === id);

export default chatSlice.reducer;
