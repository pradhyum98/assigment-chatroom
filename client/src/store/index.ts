import { configureStore } from '@reduxjs/toolkit';
import type { Middleware } from '@reduxjs/toolkit';
import authReducer from '../features/auth/authSlice';
import roomsReducer from '../features/rooms/roomsSlice';
import chatReducer from '../features/chat/chatSlice';
import friendsReducer from '../features/friends/friendsSlice';
import { SecureKeyWrapper } from '../services/secureKeyWrapper';

const e2eeCleanupMiddleware: Middleware = (storeApi) => (next) => (action: any) => {
  if (action.type === 'auth/logout') {
    const state = storeApi.getState();
    const accountId = state.auth.user?._id;
    if (accountId) {
      SecureKeyWrapper.clearWrappedKey(accountId).catch((err) => {
        console.error('[Middleware] Failed to clear native wrapped key:', err);
      });
    }
  }
  return next(action);
};

export const store = configureStore({
  reducer: {
    auth: authReducer,
    rooms: roomsReducer,
    chat: chatReducer,
    friends: friendsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(e2eeCleanupMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
