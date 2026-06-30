import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface Room {
  _id: string;
  roomId: string;
  roomName?: string;
  createdBy: any;
  participants: any[];
  createdAt: string;
  avatarColor: string;
  previewText: string;
  isDM?: boolean;
  isPrivate?: boolean;
  isOnline?: boolean;
  lastSeen?: string;
  encryptedRoomKeys?: Record<string, string>;
  unreadCounts?: Record<string, number>;
  unreadCount?: number; // legacy/derived
  pinnedMessages?: any[];
  lastMessage?: any;
}

interface RoomsState {
  rooms: Room[];
  currentRoom: Room | null;
  loading: boolean;
  error: string | null;
}

const initialState: RoomsState = {
  rooms: [],
  currentRoom: null,
  loading: false,
  error: null,
};

const roomsSlice = createSlice({
  name: 'rooms',
  initialState,
  reducers: {
    setRooms: (state, action: PayloadAction<Room[]>) => {
      const mergedRooms = action.payload.map(newRoom => {
        const existing = state.rooms.find(r => r.roomId === newRoom.roomId);
        if (existing) {
          return {
            ...existing,
            ...newRoom,
            unreadCounts: {
              ...existing.unreadCounts,
              ...newRoom.unreadCounts
            },
            isOnline: newRoom.isOnline !== undefined ? newRoom.isOnline : existing.isOnline,
            lastSeen: newRoom.lastSeen !== undefined ? newRoom.lastSeen : existing.lastSeen,
          };
        }
        return newRoom;
      });
      state.rooms = mergedRooms;

      if (state.currentRoom) {
        const fresh = mergedRooms.find(r => r.roomId === state.currentRoom!.roomId);
        if (fresh) {
          state.currentRoom = {
            ...state.currentRoom,
            ...fresh
          };
        }
      }
    },
    setCurrentRoom: (state, action: PayloadAction<Room | null>) => {
      state.currentRoom = action.payload;
    },
    addRoom: (state, action: PayloadAction<Room>) => {
      state.rooms.unshift(action.payload);
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    updateRoomPreview: (state, action: PayloadAction<{ roomId: string; previewText: string; unreadIncrementFor?: string }>) => {
      const room = state.rooms.find(r => r.roomId === action.payload.roomId);
      if (room) {
        room.previewText = action.payload.previewText;
        if (action.payload.unreadIncrementFor) {
          if (!room.unreadCounts) room.unreadCounts = {};
          const current = room.unreadCounts[action.payload.unreadIncrementFor] || 0;
          room.unreadCounts[action.payload.unreadIncrementFor] = current + 1;
        }
      }
    },
    clearUnreadCount: (state, action: PayloadAction<{ roomId: string; userId: string }>) => {
      const room = state.rooms.find(r => r.roomId === action.payload.roomId);
      if (room && room.unreadCounts) {
        room.unreadCounts[action.payload.userId] = 0;
      }
    },
    updatePresence: (state, action: PayloadAction<{ userId: string; isOnline: boolean; lastSeen: string }>) => {
      state.rooms.forEach(room => {
        if (room.isDM) {
          const isOtherParticipant = room.participants?.some(p => p._id === action.payload.userId);
          if (isOtherParticipant) {
            room.isOnline = action.payload.isOnline;
            room.lastSeen = action.payload.lastSeen;
          }
        }
      });
      if (state.currentRoom?.isDM) {
        const isOtherParticipant = state.currentRoom.participants?.some(p => p._id === action.payload.userId);
        if (isOtherParticipant) {
          state.currentRoom.isOnline = action.payload.isOnline;
          state.currentRoom.lastSeen = action.payload.lastSeen;
        }
      }
    },
    updatePinnedMessages: (state, action: PayloadAction<{ roomId: string; pinnedMessages: any[] }>) => {
      const room = state.rooms.find(r => r.roomId === action.payload.roomId);
      if (room) room.pinnedMessages = action.payload.pinnedMessages;
      if (state.currentRoom?.roomId === action.payload.roomId) {
        state.currentRoom.pinnedMessages = action.payload.pinnedMessages;
      }
    },
  },
});

export const { setRooms, setCurrentRoom, addRoom, setLoading, setError, updateRoomPreview, clearUnreadCount, updatePresence, updatePinnedMessages } = roomsSlice.actions;
export default roomsSlice.reducer;
