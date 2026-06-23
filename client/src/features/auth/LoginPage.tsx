import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { loginStart, loginSuccess, loginFailure } from './authSlice';
import api from '../../services/api';
import { CryptoService } from '../../services/cryptoService';
import './Auth.css';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { loading, error } = useAppSelector((state) => state.auth);

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
          console.warn('Failed to decrypt private key. Generating new keypair...', err);
          const keyPair = await CryptoService.generateUserKeyPair();
          publicKey = await CryptoService.exportPublicKey(keyPair.publicKey);
          privateKey = await CryptoService.exportPrivateKey(keyPair.privateKey);
          
          const encryptedPrivateKey = await CryptoService.encryptPrivateKeyWithPassword(privateKey, password, email);
          // Update keys on server
          response = await api.post('/auth/login', { email, password, publicKey, encryptedPrivateKey });
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

      // Save private key locally for current session
      localStorage.setItem('e2e_private_key', privateKey);
      dispatch(loginSuccess(response.data.data));
      navigate('/');
    } catch (err: any) {
      dispatch(loginFailure(err.response?.data?.message || 'Login failed'));
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card fade-in">
        <h2>Login</h2>
        <p className="auth-subtitle">Welcome back! Please login to your account.</p>
        {error && <div className="auth-error">{error}</div>}
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
        <p className="auth-footer">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
