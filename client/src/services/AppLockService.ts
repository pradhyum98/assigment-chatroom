import { registerPlugin } from '@capacitor/core';

const BiometricAuth = registerPlugin<any>('BiometricAuth');

export type LockType = 'pin' | 'pattern';

export class AppLockService {
  private static STORAGE_PREFIX = 'app_lock_';

  /**
   * Generates a secure random salt (hex string)
   */
  private static generateSalt(): string {
    const arr = new Uint8Array(16);
    window.crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Derive a secure slow hash using PBKDF2 (HMAC-SHA256, 100,000 iterations)
   */
  public static async deriveHash(credential: string, salt: string): Promise<string> {
    const encoder = new TextEncoder();
    const credBuffer = encoder.encode(credential);
    const saltBuffer = encoder.encode(salt);

    // Import the raw credential as a key object
    const rawKey = await window.crypto.subtle.importKey(
      'raw',
      credBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    // Derive the bits using PBKDF2
    const derivedBits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: 100000,
        hash: 'SHA-256'
      },
      rawKey,
      256
    );

    // Convert to hex string
    const arr = new Uint8Array(derivedBits);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // --- Configuration ---

  public static isEnabled(): boolean {
    return localStorage.getItem(this.STORAGE_PREFIX + 'enabled') === 'true';
  }

  public static getLockType(): LockType {
    return (localStorage.getItem(this.STORAGE_PREFIX + 'type') as LockType) || 'pin';
  }

  public static getAutoLockTimeout(): number {
    const val = localStorage.getItem(this.STORAGE_PREFIX + 'timeout');
    return val ? parseInt(val, 10) : 0; // default to immediately (0)
  }

  public static isBiometricsEnabled(): boolean {
    return localStorage.getItem(this.STORAGE_PREFIX + 'biometrics_enabled') === 'true';
  }

  public static async checkNativeBiometricsAvailable(): Promise<{ available: boolean; code: string }> {
    try {
      const res = await BiometricAuth.isBiometricAvailable();
      return {
        available: !!res.available,
        code: res.code || 'UNKNOWN'
      };
    } catch (e) {
      console.warn('[AppLockService] checkNativeBiometricsAvailable failed:', e);
      return { available: false, code: 'UNSUPPORTED' };
    }
  }

  public static async triggerNativeBiometricAuth(): Promise<boolean> {
    try {
      const res = await BiometricAuth.authenticate({
        title: 'App Lock',
        subtitle: 'Authenticate to unlock your Secure Chat app'
      });
      return !!res.success;
    } catch (e) {
      console.error('[AppLockService] triggerNativeBiometricAuth crashed:', e);
      return false;
    }
  }

  // --- Setting Credentials ---

  public static async setLock(type: LockType, credential: string, biometricsEnabled: boolean): Promise<void> {
    const salt = this.generateSalt();
    const hash = await this.deriveHash(credential, salt);

    localStorage.setItem(this.STORAGE_PREFIX + 'enabled', 'true');
    localStorage.setItem(this.STORAGE_PREFIX + 'type', type);
    localStorage.setItem(this.STORAGE_PREFIX + 'salt', salt);
    localStorage.setItem(this.STORAGE_PREFIX + 'biometrics_enabled', biometricsEnabled ? 'true' : 'false');

    // Store the verifier hash securely
    try {
      // In Android, save it inside Keystore-backed storage
      await BiometricAuth.setSecureSecret({
        alias: 'com.securechat.applock.verifier',
        secret: hash
      });
    } catch (e) {
      console.log('[AppLockService] Native secure secret storage unavailable.');
    }
    // Always persist the slow-KDF hash in localStorage as a secure fallback to prevent lockout if KeyStore fails
    localStorage.setItem(this.STORAGE_PREFIX + 'hash', hash);
  }

  public static async disableLock(): Promise<void> {
    localStorage.removeItem(this.STORAGE_PREFIX + 'enabled');
    localStorage.removeItem(this.STORAGE_PREFIX + 'type');
    localStorage.removeItem(this.STORAGE_PREFIX + 'salt');
    localStorage.removeItem(this.STORAGE_PREFIX + 'hash');
    localStorage.removeItem(this.STORAGE_PREFIX + 'biometrics_enabled');
    localStorage.removeItem(this.STORAGE_PREFIX + 'timeout');

    try {
      await BiometricAuth.deleteSecureSecret({ alias: 'com.securechat.applock.verifier' });
    } catch (e) {
      // Ignore
    }
  }

  public static setAutoLockTimeout(timeoutMs: number): void {
    localStorage.setItem(this.STORAGE_PREFIX + 'timeout', timeoutMs.toString());
  }

  // --- Verification ---

  public static async verifyCredential(credential: string): Promise<boolean> {
    if (!this.isEnabled()) return true;

    const salt = localStorage.getItem(this.STORAGE_PREFIX + 'salt');
    if (!salt) return false;

    const inputHash = await this.deriveHash(credential, salt);

    // Retrieve stored verifier hash
    let storedHash: string | null = null;
    try {
      const res = await BiometricAuth.getSecureSecret({ alias: 'com.securechat.applock.verifier' });
      storedHash = res.secret;
    } catch (e) {
      // Fallback
    }

    if (!storedHash) {
      storedHash = localStorage.getItem(this.STORAGE_PREFIX + 'hash');
    }

    return inputHash === storedHash;
  }

  // --- Runtime Session State ---

  private static isSessionLocked = false;
  private static lastActiveTime: number = Date.now();

  public static isAppCurrentlyLocked(): boolean {
    if (!this.isEnabled()) return false;
    return this.isSessionLocked;
  }

  public static setSessionLocked(locked: boolean): void {
    this.isSessionLocked = locked;
  }

  public static updateActivity(): void {
    this.lastActiveTime = Date.now();
  }

  /**
   * Evaluates background time to see if lock should engage.
   */
  public static checkAndLockOnResume(): boolean {
    if (!this.isEnabled()) return false;

    const elapsed = Date.now() - this.lastActiveTime;
    const timeout = this.getAutoLockTimeout();

    if (elapsed >= timeout) {
      this.isSessionLocked = true;
      return true;
    }
    return this.isSessionLocked;
  }
}
