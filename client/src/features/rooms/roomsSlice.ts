import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface Room {
  _id: string;
  roomId: string;
  roomName: string;
  createdBy: any;
  participants: string[];
  createdAt: string;
  avatarColor: string;
  previewText: string;
  isOnline?: boolean;
  unreadCount?: number;
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
      state.rooms = action.payload;
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
  },
});

export const { setRooms, setCurrentRoom, addRoom, setLoading, setError } = roomsSlice.actions;
export default roomsSlice.reducer;
