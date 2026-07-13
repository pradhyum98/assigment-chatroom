import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { loginStart, loginSuccess, loginFailure } from './authSlice';
import api from '../../services/api';
import { CryptoService } from '../../services/cryptoService';
import { secretStore } from '../../services/secretStore';
import { SecureKeyWrapper } from '../../services/secureKeyWrapper';
import './Auth.css';

const SignupPage: React.FC = () => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { loading, error, isAuthenticated } = useAppSelector((state) => state.auth);

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch(loginStart());
    try {
      // Generate E2EE Keys
      const keyPair = await CryptoService.generateUserKeyPair();
      const publicKey = await CryptoService.exportPublicKey(keyPair.publicKey);
      const privateKey = await CryptoService.exportPrivateKey(keyPair.privateKey);

      // Encrypt private key with user password (PBKDF2)
      const encryptedPrivateKey = await CryptoService.encryptPrivateKeyWithPassword(privateKey, formData.password, formData.email);

      // Save private key in memory
      secretStore.setPrivateKey(keyPair.privateKey);

      const payload = { ...formData, publicKey, encryptedPrivateKey };
      const response = await api.post('/auth/signup', payload);

      // Wrap E2EE private key bound to device!
      SecureKeyWrapper.incrementSession();
      await SecureKeyWrapper.wrapAndStorePrivateKey(response.data.data.user._id, response.data.data.user.identityVersion || 1, keyPair.privateKey);

      dispatch(loginSuccess(response.data.data));
      navigate('/', { replace: true });
    } catch (err: any) {
      dispatch(loginFailure(err.response?.data?.message || 'Signup failed'));
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card fade-in">
        <h2>Create Account</h2>
        <p className="auth-subtitle">Join us and start chatting in real-time.</p>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>First Name</label>
              <input 
                name="firstName"
                type="text" 
                placeholder="John" 
                value={formData.firstName} 
                onChange={handleChange} 
                required 
              />
            </div>
            <div className="form-group">
              <label>Last Name</label>
              <input 
                name="lastName"
                type="text" 
                placeholder="Doe" 
                value={formData.lastName} 
                onChange={handleChange} 
                required 
              />
            </div>
          </div>
          <div className="form-group">
            <label>Email Address</label>
            <input 
              name="email"
              type="email" 
              placeholder="john.doe@example.com" 
              value={formData.email} 
              onChange={handleChange} 
              required 
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input 
              name="password"
              type="password" 
              placeholder="Min 6 characters" 
              value={formData.password} 
              onChange={handleChange} 
              required 
            />
          </div>
          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>
        <p className="auth-footer">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </div>
    </div>
  );
};

export default SignupPage;
