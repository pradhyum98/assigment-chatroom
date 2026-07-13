import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { loginStart, loginSuccess, loginFailure } from './authSlice';
import api from '../../services/api';
import { CryptoService } from '../../services/cryptoService';
import { secretStore } from '../../services/secretStore';
import { SecureKeyWrapper } from '../../services/secureKeyWrapper';
import { getLocalAccountCleanupService } from '../../services/LocalAccountCleanupService';
import './Auth.css';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showIdentityReset, setShowIdentityReset] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { loading, error, isAuthenticated } = useAppSelector((state) => state.auth);

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch(loginStart());
    try {
      // First authenticate without public key to fetch the user profile
      let response = await api.post('/auth/login', { email, password });
      const { user } = response.data.data;

      let privateKey = '';
      let publicKey = '';

      if (user.encryptedPrivateKey && user.publicKey) {
        try {
          privateKey = await CryptoService.decryptPrivateKeyWithPassword(
            user.encryptedPrivateKey,
            password,
            email
          );
          publicKey = user.publicKey;
        } catch (err) {
          console.warn('Failed to decrypt private key.', err);
          dispatch(loginFailure('E2EE key decryption failed. Your password may have been reset.'));
          setShowIdentityReset(true);
          return;
        }
      } else {
        // Legacy user or new device without backed up keys
        const keyPair = await CryptoService.generateUserKeyPair();
        publicKey = await CryptoService.exportPublicKey(keyPair.publicKey);
        privateKey = await CryptoService.exportPrivateKey(keyPair.privateKey);
        
        const encryptedPrivateKey = await CryptoService.encryptPrivateKeyWithPassword(privateKey, password, email);
        // Update keys on server
        response = await api.post('/auth/login', { email, password, publicKey, encryptedPrivateKey });
      }

      // Save private key in memory
      const importedPrivKey = await CryptoService.importPrivateKey(privateKey);
      secretStore.setPrivateKey(importedPrivKey);

      // Wrap and store key bound to device!
      SecureKeyWrapper.incrementSession();
      await SecureKeyWrapper.wrapAndStorePrivateKey(response.data.data.user._id, response.data.data.user.identityVersion || 1, importedPrivKey);

      dispatch(loginSuccess(response.data.data));
      navigate('/', { replace: true });
    } catch (err: any) {
      dispatch(loginFailure(err.response?.data?.message || 'Login failed'));
    }
  };

  const handleIdentityReset = async () => {
    setResetLoading(true);
    try {
      const keyPair = await CryptoService.generateUserKeyPair();
      const publicKey = await CryptoService.exportPublicKey(keyPair.publicKey);
      const privateKey = await CryptoService.exportPrivateKey(keyPair.privateKey);
      const encryptedPrivateKey = await CryptoService.encryptPrivateKeyWithPassword(privateKey, password, email);

      const response = await api.post('/auth/reset-identity', {
        publicKey,
        encryptedPrivateKey
      });
      
      const importedPrivKey = await CryptoService.importPrivateKey(privateKey);
      
      const userObj = response.data.data.user;

      // Clear old native key
      await SecureKeyWrapper.clearWrappedKey(userObj._id);

      // Clear in-memory secretStore
      secretStore.clearAll();

      // Clear legacy storage
      localStorage.removeItem('e2e_private_key');
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('room_key_')) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));

      // Clear old IndexedDB staging & outbox data
      const cleanupService = getLocalAccountCleanupService();
      if (cleanupService) {
        await cleanupService.purgeIdentityResetData(userObj._id);
      }

      secretStore.setPrivateKey(importedPrivKey);

      // Wrap new E2E private key bound to device!
      SecureKeyWrapper.incrementSession();
      await SecureKeyWrapper.wrapAndStorePrivateKey(userObj._id, userObj.identityVersion || 1, importedPrivKey);

      dispatch(loginSuccess(response.data.data));
      setShowIdentityReset(false);
      navigate('/', { replace: true });
    } catch (err: any) {
      dispatch(loginFailure(err.response?.data?.message || 'Failed to reset identity'));
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card fade-in">
        <h2>Login</h2>
        <p className="auth-subtitle">Welcome back! Please login to your account.</p>
        {error && <div className="auth-error">{error}</div>}
        
        {!showIdentityReset ? (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Email Address</label>
              <input 
                type="email" 
                placeholder="Enter your email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                required 
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input 
                type="password" 
                placeholder="Enter your password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
              />
            </div>
            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        ) : (
          <div className="identity-reset-prompt">
            <p><strong>Warning:</strong> We could not decrypt your secure messages key. This usually happens if your password was reset.</p>
            <p>You must reset your E2EE identity to continue. <em>You will lose access to all your past messages in E2EE rooms.</em></p>
            <button onClick={handleIdentityReset} className="auth-button danger" disabled={resetLoading}>
              {resetLoading ? 'Resetting...' : 'Reset E2EE Identity'}
            </button>
            <button onClick={() => setShowIdentityReset(false)} className="auth-button secondary" disabled={resetLoading} style={{marginTop: '10px', background: '#333'}}>
              Cancel
            </button>
          </div>
        )}
        <p className="auth-footer">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
