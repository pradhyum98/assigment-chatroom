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
  typingUsers: Record<string, string>; // userId -> userName
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
    setTyping: (state, action: PayloadAction<{ userId: string; userName: string; isTyping: boolean }>) => {
      if (action.payload.isTyping) {
        state.typingUsers[action.payload.userId] = action.payload.userName;
      } else {
        delete state.typingUsers[action.payload.userId];
      }
    },
    clearTyping: (state) => {
      state.typingUsers = {};
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
  setTyping, clearTyping, confirmMessageSent
} = chatSlice.actions;
export default chatSlice.reducer;
