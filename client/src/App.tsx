import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAppSelector } from './store/hooks';
import LoginPage from './features/auth/LoginPage';
import SignupPage from './features/auth/SignupPage';
import ChatRoom from './features/chat/ChatRoom';
import { CallProvider } from './features/calls/CallContext';
import './index.css';
import { subscribeToPushNotifications } from './services/pushNotifications';

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
  const { token } = useAppSelector((state) => state.auth);

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
