import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from './store/hooks';
import LoginPage from './features/auth/LoginPage';
import SignupPage from './features/auth/SignupPage';
import ChatRoom from './features/chat/ChatRoom';
import { CallProvider } from './features/calls/CallContext';
import './index.css';
import { subscribeToPushNotifications } from './services/pushNotifications';
import { loginSuccess, logoutUser, updateUser, setStartupState } from './features/auth/authSlice';
import api, { setAccessToken } from './services/api';
import { syncEngine } from './services/SyncEngine';
import { SecureKeyWrapper } from './services/secureKeyWrapper';
import E2eeUnlockPage from './features/auth/E2eeUnlockPage';
import { canonicalDb } from './services/CanonicalDatabase';
import { secretStore } from './services/secretStore';
import { AppLockOverlay } from './features/auth/AppLockOverlay';


const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, startupState } = useAppSelector((state) => state.auth);

  if (startupState === 'RESTORING_SESSION' || startupState === 'RESTORING_E2EE_KEY' || startupState === 'HYDRATING_LOCAL_STATE' || startupState === 'RECOVERING') {
    return (
      <div className="flex-center full-screen bg-app">
        <div className="loading-spinner">Validating session ({startupState})...</div>
      </div>
    );
  }

  if (isAuthenticated) {
    if (startupState === 'E2EE_UNLOCK_REQUIRED') {
      return <E2eeUnlockPage />;
    }
    return children;
  }

  return <Navigate to="/login" replace />;
};

const App: React.FC = () => {
  const dispatch = useAppDispatch();
  const { token, user, startupState } = useAppSelector((state) => state.auth);
  const currentRoom = useAppSelector((state) => state.rooms.currentRoom);
  const currentRoomRef = React.useRef(currentRoom);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

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

  // Listen to native Android Back Button to prevent accidental logouts
  useEffect(() => {
    let listenerPromise: Promise<any> | null = null;
    
    import('@capacitor/app').then(({ App: CapApp }) => {
      listenerPromise = CapApp.addListener('backButton', (data) => {
        const path = window.location.pathname;
        if (path === '/' || path === '/login' || path === '/signup' || !data.canGoBack) {
          if (path === '/' && currentRoomRef.current) {
            import('./features/rooms/roomsSlice').then(({ setCurrentRoom }) => {
              dispatch(setCurrentRoom(null));
            });
          } else {
            CapApp.exitApp();
          }
        } else {
          window.history.back();
        }
      });
    });

    return () => {
      if (listenerPromise) {
        listenerPromise.then((l) => l.remove());
      }
    };
  }, []);

  // Bootstrap session state machine
  useEffect(() => {
    const bootstrap = async () => {
      // 0. Transition from UNAUTHENTICATED on active credentials (login/signup)
      if (startupState === 'UNAUTHENTICATED' && token && user) {
        dispatch(setStartupState('RESTORING_E2EE_KEY'));
        return;
      }

      const hasSession = localStorage.getItem('hasSession') === 'true';
      
      // 1. RESTORING_SESSION
      if (startupState === 'RESTORING_SESSION') {
        if (hasSession && !token) {
          try {
            console.log('[App] Attempting silent refresh bootstrap...');
            const response = await api.post('/auth/refresh');
            const { token: newToken, user: freshUser } = response.data.data;
            setAccessToken(newToken);
            dispatch(loginSuccess({ user: freshUser, token: newToken }));
            dispatch(setStartupState('RESTORING_E2EE_KEY'));
          } catch (err: any) {
            console.error('[App] Bootstrap silent refresh failed:', err);
            setAccessToken(null);

            const isNetworkError = !err.response || err.code === 'ERR_NETWORK' || err.message === 'Network Error';
            const savedUser = JSON.parse(localStorage.getItem('user') || 'null');

            if (isNetworkError && savedUser) {
              console.log('[App] Offline connectivity detected. Restoring offline profile.');
              dispatch(updateUser(savedUser));
              dispatch(setStartupState('RESTORING_E2EE_KEY'));
            } else {
              // 401, 403, or invalid token/session: log out
              console.warn('[App] Session invalid/revoked. Directing to unauthenticated.');
              dispatch(logoutUser());
              dispatch(setStartupState('UNAUTHENTICATED'));
            }
          }
        } else if (token) {
          dispatch(setStartupState('RESTORING_E2EE_KEY'));
        } else {
          dispatch(setStartupState('UNAUTHENTICATED'));
        }
      }

      // 2. RESTORING_E2EE_KEY
      if (startupState === 'RESTORING_E2EE_KEY') {
        if (user && user._id) {
          try {
            console.log('[App] Restoring device-wrapped E2EE private key...');
            const result = await SecureKeyWrapper.unwrapAndLoadPrivateKey(user._id, user.identityVersion || 1);
            if (result === 'SUCCESS') {
              dispatch(setStartupState('HYDRATING_LOCAL_STATE'));
            } else if (result === 'NO_KEY') {
              if (secretStore.getPrivateKey()) {
                dispatch(setStartupState('HYDRATING_LOCAL_STATE'));
              } else {
                console.log('[App] Private key is missing from memory and device keystore. E2EE Unlock required.');
                dispatch(setStartupState('E2EE_UNLOCK_REQUIRED'));
              }
            } else if (result === 'KEY_INVALIDATED' || result === 'ERROR') {
              dispatch(setStartupState('E2EE_UNLOCK_REQUIRED'));
            }
          } catch (e) {
            console.error('[App] E2EE key restoration crashed:', e);
            dispatch(setStartupState('E2EE_UNLOCK_REQUIRED'));
          }
        } else {
          dispatch(setStartupState('UNAUTHENTICATED'));
        }
      }

      // 3. HYDRATING_LOCAL_STATE
      if (startupState === 'HYDRATING_LOCAL_STATE') {
        try {
          console.log('[App] Hydrating local IndexedDB databases...');
          await canonicalDb.open();
          dispatch(setStartupState('RECOVERING'));
        } catch (e) {
          console.error('[App] Database hydration failed:', e);
          dispatch(setStartupState('FATAL'));
        }
      }

      // 4. RECOVERING
      if (startupState === 'RECOVERING') {
        if (user && user._id) {
          try {
            console.log('[App] Recovering sync engine stream and catch-up...');
            await syncEngine.init(user._id);
            if (navigator.onLine) {
              dispatch(setStartupState('READY'));
            } else {
              dispatch(setStartupState('OFFLINE_READY'));
            }
          } catch (e) {
            console.error('[App] SyncEngine recovery failed:', e);
            if (navigator.onLine) {
              dispatch(setStartupState('READY'));
            } else {
              dispatch(setStartupState('OFFLINE_READY'));
            }
          }
        } else {
          dispatch(setStartupState('UNAUTHENTICATED'));
        }
      }
    };

    bootstrap();
  }, [startupState, token, user, dispatch]);

  useEffect(() => {
    if (startupState === 'READY' || startupState === 'OFFLINE_READY') {
      subscribeToPushNotifications();
    }
  }, [startupState]);

  return (
    <Router>
      <AppLockOverlay />
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
