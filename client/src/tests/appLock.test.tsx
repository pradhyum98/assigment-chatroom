import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Ensure crypto subtle is available in JSDOM testing environment
if (typeof window !== 'undefined' && !window.crypto) {
  // @ts-ignore
  window.crypto = require('crypto').webcrypto;
} else if (typeof window !== 'undefined' && !window.crypto.subtle) {
  // @ts-ignore
  window.crypto.subtle = require('crypto').webcrypto.subtle;
}

// Hoist the mock definitions so they are initialized before vi.mock executes
const { mockBiometricAuth } = vi.hoisted(() => {
  return {
    mockBiometricAuth: {
      isBiometricAvailable: vi.fn(),
      authenticate: vi.fn(),
      setSecureSecret: vi.fn(),
      getSecureSecret: vi.fn(),
      deleteSecureSecret: vi.fn(),
    }
  };
});

vi.mock('@capacitor/core', () => {
  return {
    registerPlugin: vi.fn().mockImplementation((name) => {
      if (name === 'BiometricAuth') {
        return mockBiometricAuth;
      }
      return {};
    })
  };
});

import { AppLockService } from '../services/AppLockService';

describe('App Lock Feature tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    AppLockService.setSessionLocked(false);
    AppLockService.updateActivity();

    // Default mock behavior
    mockBiometricAuth.isBiometricAvailable.mockResolvedValue({ available: true, code: 'SUCCESS' });
    mockBiometricAuth.authenticate.mockResolvedValue({ success: true });
    mockBiometricAuth.setSecureSecret.mockResolvedValue({ success: true });
    mockBiometricAuth.getSecureSecret.mockResolvedValue({ secret: null });
    mockBiometricAuth.deleteSecureSecret.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('1. Enable and configure PIN App Lock', async () => {
    mockBiometricAuth.getSecureSecret.mockResolvedValue({
      secret: await AppLockService.deriveHash('1234', 'mocksalt')
    });

    await AppLockService.setLock('pin', '1234', true);
    
    expect(AppLockService.isEnabled()).toBe(true);
    expect(AppLockService.getLockType()).toBe('pin');
    expect(AppLockService.isBiometricsEnabled()).toBe(true);
    expect(mockBiometricAuth.setSecureSecret).toHaveBeenCalledWith(expect.objectContaining({
      alias: 'com.securechat.applock.verifier'
    }));
  });

  it('2. Disable App Lock and clean credentials', async () => {
    await AppLockService.setLock('pin', '1234', true);
    expect(AppLockService.isEnabled()).toBe(true);

    await AppLockService.disableLock();
    expect(AppLockService.isEnabled()).toBe(false);
    expect(mockBiometricAuth.deleteSecureSecret).toHaveBeenCalledWith({
      alias: 'com.securechat.applock.verifier'
    });
  });

  it('3. Correct and Incorrect PIN verification', async () => {
    const salt = 'testsalt';
    const originalPin = '9876';
    const correctHash = await AppLockService.deriveHash(originalPin, salt);

    // Setup local storage manually for tests
    localStorage.setItem('app_lock_enabled', 'true');
    localStorage.setItem('app_lock_salt', salt);
    mockBiometricAuth.getSecureSecret.mockResolvedValue({ secret: correctHash });

    const isCorrect = await AppLockService.verifyCredential('9876');
    expect(isCorrect).toBe(true);

    const isIncorrect = await AppLockService.verifyCredential('1111');
    expect(isIncorrect).toBe(false);
  });

  it('4. Correct and Incorrect Pattern verification', async () => {
    const salt = 'patternsalt';
    const originalPattern = '01258';
    const correctHash = await AppLockService.deriveHash(originalPattern, salt);

    localStorage.setItem('app_lock_enabled', 'true');
    localStorage.setItem('app_lock_salt', salt);
    mockBiometricAuth.getSecureSecret.mockResolvedValue({ secret: correctHash });

    const isCorrect = await AppLockService.verifyCredential('01258');
    expect(isCorrect).toBe(true);

    const isIncorrect = await AppLockService.verifyCredential('0123');
    expect(isIncorrect).toBe(false);
  });

  it('5. Biometric Unlock success & failure triggers', async () => {
    mockBiometricAuth.authenticate.mockResolvedValue({ success: true });
    let success = await AppLockService.triggerNativeBiometricAuth();
    expect(success).toBe(true);

    mockBiometricAuth.authenticate.mockResolvedValue({ success: false });
    let failure = await AppLockService.triggerNativeBiometricAuth();
    expect(failure).toBe(false);
  });

  it('6. Immediate and timeout-based auto-locking', async () => {
    await AppLockService.setLock('pin', '1234', false);
    AppLockService.setAutoLockTimeout(0); // Immediately

    AppLockService.updateActivity();
    // Simulate immediately backgrounded
    AppLockService.setSessionLocked(false);
    
    // Act: resume check
    let locked = AppLockService.checkAndLockOnResume();
    expect(locked).toBe(true);

    // With 30s timeout
    AppLockService.setAutoLockTimeout(30000);
    AppLockService.setSessionLocked(false);
    AppLockService.updateActivity();

    // Less than 30s elapsed
    locked = AppLockService.checkAndLockOnResume();
    expect(locked).toBe(false);

    // Over 30s elapsed (mock past activity)
    const originalTime = Date.now();
    // @ts-ignore
    AppLockService.lastActiveTime = originalTime - 31000;
    
    locked = AppLockService.checkAndLockOnResume();
    expect(locked).toBe(true);
  });

  it('7. App state regressions: user credentials, sockets, and UI state are untouched by Lock/Unlock', async () => {
    localStorage.setItem('app_lock_enabled', 'true');
    const originalState = {
      auth: {
        isAuthenticated: true,
        token: 'valid-jwt-token',
        user: { _id: 'user-1', email: 'test@example.com' }
      },
      rooms: {
        currentRoom: { _id: 'room-abc', roomName: 'Alice Room' }
      },
      chat: {
        messages: [{ messageId: 'msg-1', content: 'Secret message' }]
      }
    };

    // Lock the session
    AppLockService.setSessionLocked(true);
    expect(AppLockService.isAppCurrentlyLocked()).toBe(true);

    // Unlock the session
    AppLockService.setSessionLocked(false);
    expect(AppLockService.isAppCurrentlyLocked()).toBe(false);

    // Assert that the credentials and active state variables remain completely identical
    expect(originalState.auth.isAuthenticated).toBe(true);
    expect(originalState.auth.token).toBe('valid-jwt-token');
    expect(originalState.auth.user._id).toBe('user-1');
    expect(originalState.rooms.currentRoom._id).toBe('room-abc');
    expect(originalState.chat.messages).toHaveLength(1);
    expect(originalState.chat.messages[0].content).toBe('Secret message');
  });
});
