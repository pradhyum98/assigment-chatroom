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
import { syncManager } from './services/syncManager';

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

  // Bootstrap session via silent refresh on initial mount
  useEffect(() => {
    const bootstrapSession = async () => {
      const hasSession = localStorage.getItem('hasSession') === 'true';
      if (hasSession && !token) {
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
        }
      } else if (!hasSession) {
        // Stop the loading spinner since we are not authenticated
        dispatch(loginFailure(''));
      }
    };

    bootstrapSession();
  }, [dispatch, token]);

  useEffect(() => {
    if (!token) return;

    syncManager.bootstrap();
    subscribeToPushNotifications();
  }, [token]);

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
