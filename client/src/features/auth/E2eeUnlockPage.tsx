import React, { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setStartupState } from './authSlice';
import { CryptoService } from '../../services/cryptoService';
import { secretStore } from '../../services/secretStore';
import { SecureKeyWrapper } from '../../services/secureKeyWrapper';
import './Auth.css';

export const E2eeUnlockPage: React.FC = () => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((state) => state.auth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      if (!user.encryptedPrivateKey) {
        throw new Error('No encrypted private key found on your profile.');
      }
      const privateKeyStr = await CryptoService.decryptPrivateKeyWithPassword(
        user.encryptedPrivateKey,
        password,
        user.email
      );
      const importedPrivKey = await CryptoService.importPrivateKey(privateKeyStr);
      secretStore.setPrivateKey(importedPrivKey);

      // Re-wrap and save key bound to device!
      SecureKeyWrapper.incrementSession();
      await SecureKeyWrapper.wrapAndStorePrivateKey(user._id, user.identityVersion || 1, importedPrivKey);

      // E2EE unlocked successfully! Continue startup state machine: transition to HYDRATING_LOCAL_STATE
      dispatch(setStartupState('HYDRATING_LOCAL_STATE'));
    } catch (err: any) {
      setError('Incorrect password or failed to decrypt key.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card fade-in">
        <h2>E2EE Unlock Required</h2>
        <p className="auth-subtitle">
          Your secure device key is missing, invalidated, or biometrics changed. Please enter your password to restore access to your messages.
        </p>
        {error && <div className="auth-error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
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
            {loading ? 'Unlocking...' : 'Unlock E2EE'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default E2eeUnlockPage;
