import crypto from 'crypto';
import { encryptPasswordForRecovery, recoverUserPassword } from '../src/utils/passwordRecovery';

describe('Password Recovery Cryptography', () => {
  const originalKey = process.env.PASSWORD_RECOVERY_KEY;

  beforeAll(() => {
    // Generate a secure 32-byte key for testing
    process.env.PASSWORD_RECOVERY_KEY = crypto.randomBytes(32).toString('hex');
  });

  afterAll(() => {
    process.env.PASSWORD_RECOVERY_KEY = originalKey;
  });

  test('Password encryption generates unique IVs and ciphertexts for the same password', () => {
    const password = 'SuperSecretPassword123!';
    
    const encrypted1 = encryptPasswordForRecovery(password);
    const encrypted2 = encryptPasswordForRecovery(password);

    // IVs must be 12 bytes (24 hex characters)
    expect(encrypted1.iv.length).toBe(24);
    expect(encrypted2.iv.length).toBe(24);

    // IVs must be different (extremely high probability)
    expect(encrypted1.iv).not.toBe(encrypted2.iv);

    // Ciphertexts must be different because IVs are different
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
  });

  test('Decryption works correctly with the correct recovery key', () => {
    const password = 'RecoverablePassword!';
    const encrypted = encryptPasswordForRecovery(password);

    const key = Buffer.from(process.env.PASSWORD_RECOVERY_KEY!, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

    let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    expect(plaintext).toBe(password);
  });

  test('Decryption fails with an incorrect recovery key', () => {
    const password = 'MyPassword';
    const encrypted = encryptPasswordForRecovery(password);

    // Swap to a fake key
    const fakeKey = crypto.randomBytes(32).toString('hex');

    expect(() => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(fakeKey, 'hex'), Buffer.from(encrypted.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
      
      let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
      plaintext += decipher.final('utf8');
    }).toThrow(); // Should throw auth tag or decipher error
  });

  test('Encryption fails if PASSWORD_RECOVERY_KEY is missing', () => {
    const tempKey = process.env.PASSWORD_RECOVERY_KEY;
    delete process.env.PASSWORD_RECOVERY_KEY;

    expect(() => encryptPasswordForRecovery('test')).toThrow('environment variable is not configured correctly');

    process.env.PASSWORD_RECOVERY_KEY = tempKey;
  });
});
