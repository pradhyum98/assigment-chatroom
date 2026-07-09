import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { setAccessToken } from '../../services/api';

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  publicKey?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  token: null, // Always keep token in memory only
  isAuthenticated: localStorage.getItem('hasSession') === 'true',
  loading: localStorage.getItem('hasSession') === 'true', // Show loader on startup if session exists
  error: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    loginSuccess: (state, action: PayloadAction<{ user: User; token: string }>) => {
      state.loading = false;
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = true;
      localStorage.setItem('user', JSON.stringify(action.payload.user));
      localStorage.setItem('hasSession', 'true');
      setAccessToken(action.payload.token);
    },
    loginFailure: (state, action: PayloadAction<string>) => {
      state.loading = false;
      state.error = action.payload;
    },
    logout: (state) => {
      // Capture userId before clearing state — needed for IDB key-prefix purge
      const accountId = state.user?._id ?? null;

      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.loading = false;
      localStorage.removeItem('user');
      localStorage.removeItem('hasSession');
      localStorage.removeItem('e2e_private_key');
      localStorage.removeItem('last_active_room_id');

      // Defense-in-depth: clear SecretStore synchronously right now
      if (typeof (globalThis as any).process === 'undefined' || (globalThis as any).process?.env?.NODE_ENV !== 'test') {
        import('../../services/secretStore').then(({ secretStore }) => {
          secretStore.clearAll();
        });
      }

      // Purge all legacy room_key_* entries from localStorage
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('room_key_')) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));

      setAccessToken(null);

      // Full IDB account wipe via SyncEngine (async, post-commit, non-fatal on failure)
      if (accountId && (typeof (globalThis as any).process === 'undefined' || (globalThis as any).process?.env?.NODE_ENV !== 'test')) {
        import('../../services/SyncEngine').then(({ syncEngine }) => {
          syncEngine.logout(accountId).catch((err: unknown) => {
            console.error('[authSlice] SyncEngine.logout IDB cleanup failed:', err);
            // Server-side revocation remains authoritative.
          });
        });
      }
    },
    updateUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
      state.isAuthenticated = true;
      state.loading = false;
      localStorage.setItem('user', JSON.stringify(action.payload));
    },
    clearError: (state) => {
      state.error = null;
    },
  },
});

export const { loginStart, loginSuccess, loginFailure, logout, updateUser, clearError } = authSlice.actions;
export default authSlice.reducer;
