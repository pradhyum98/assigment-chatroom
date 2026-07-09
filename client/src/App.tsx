import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from './store/hooks';
import LoginPage from './features/auth/LoginPage';
import SignupPage from './features/auth/SignupPage';
import ChatRoom from './features/chat/ChatRoom';
import { CallProvider } from './features/calls/CallContext';
import './index.css';
import { subscribeToPushNotifications } from './services/pushNotifications';
import { loginSuccess, logout, loginFailure } from './features/auth/authSlice';
import api, { setAccessToken } from './services/api';
import { syncEngine } from './services/SyncEngine';

const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, loading } = useAppSelector((state) => state.auth);

  if (loading) {
    return (
      <div className="flex-center full-screen bg-app">
        <div className="loading-spinner">Validating session...</div>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

const App: React.FC = () => {
  const dispatch = useAppDispatch();
  const { token } = useAppSelector((state) => state.auth);

  // Clean up any legacy plaintext keys from localStorage on startup
  useEffect(() => {
    const cleanLegacyKeys = () => {
      localStorage.removeItem('e2e_private_key');
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('room_key_')) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    };
    cleanLegacyKeys();
  }, []);

// Keep a module-level promise to deduplicate concurrent bootstrap requests (e.g. from React StrictMode double mounts)
let bootstrapPromise: Promise<void> | null = null;

  // Bootstrap session via silent refresh on initial mount
  useEffect(() => {
    const bootstrapSession = async () => {
      const hasSession = localStorage.getItem('hasSession') === 'true';
      if (hasSession && !token) {
        if (bootstrapPromise) {
          return;
        }
        bootstrapPromise = (async () => {
          try {
            console.log('[App] Attempting silent refresh bootstrap...');
            const response = await api.post('/auth/refresh');
            const { token: newToken, user } = response.data.data;
            setAccessToken(newToken);
            dispatch(loginSuccess({ user, token: newToken }));
          } catch (err) {
            console.error('[App] Bootstrap silent refresh failed:', err);
            setAccessToken(null);
            dispatch(logout());
          } finally {
            bootstrapPromise = null;
          }
        })();
        await bootstrapPromise;
      } else if (!hasSession) {
        // Stop the loading spinner since we are not authenticated
        dispatch(loginFailure(''));
      }
    };

    bootstrapSession();
  }, [dispatch, token]);

  const user = useAppSelector((state) => state.auth.user);

  useEffect(() => {
    if (user && user._id) {
      syncEngine.init(user._id);
    }
    subscribeToPushNotifications();
  }, [user, token]);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/register" element={<Navigate to="/signup" replace />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <CallProvider>
                <ChatRoom />
              </CallProvider>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;
