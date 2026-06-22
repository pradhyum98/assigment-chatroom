import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface Friend {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface FriendRequest {
  _id: string;
  sender: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  recipient: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

interface FriendsState {
  friends: Friend[];
  pendingRequests: FriendRequest[];
  searchResults: Friend[];
  loading: boolean;
  error: string | null;
}

const initialState: FriendsState = {
  friends: [],
  pendingRequests: [],
  searchResults: [],
  loading: false,
  error: null,
};

const friendsSlice = createSlice({
  name: 'friends',
  initialState,
  reducers: {
    setFriends: (state, action: PayloadAction<Friend[]>) => {
      state.friends = action.payload;
    },
    setPendingRequests: (state, action: PayloadAction<FriendRequest[]>) => {
      state.pendingRequests = action.payload;
    },
    setSearchResults: (state, action: PayloadAction<Friend[]>) => {
      state.searchResults = action.payload;
    },
    addFriend: (state, action: PayloadAction<Friend>) => {
      if (!state.friends.some((f) => f._id === action.payload._id)) {
        state.friends.push(action.payload);
      }
    },
    removeFriendFromState: (state, action: PayloadAction<string>) => {
      state.friends = state.friends.filter((f) => f._id !== action.payload);
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
});

export const {
  setFriends,
  setPendingRequests,
  setSearchResults,
  addFriend,
  removeFriendFromState,
  setLoading,
  setError,
} = friendsSlice.actions;

export default friendsSlice.reducer;
