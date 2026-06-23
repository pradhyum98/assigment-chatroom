import crypto from 'crypto';
import { User } from '../models/User';
import { auditLog } from './auditLogger';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 1;

/**
 * Encrypts a plaintext password using the server's recovery key.
 * This should ONLY be called when generating/updating a user's password.
 */
export function encryptPasswordForRecovery(plaintext: string) {
  const keyHex = process.env.PASSWORD_RECOVERY_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('PASSWORD_RECOVERY_KEY environment variable is not configured correctly');
  }

  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag,
    version: VERSION,
  };
}

/**
 * Recovers a user's password from the database.
 * NEVER expose this to a public endpoint.
 */
export async function recoverUserPassword(userId: string, adminEmail: string, reason: string): Promise<string> {
  const keyHex = process.env.PASSWORD_RECOVERY_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('PASSWORD_RECOVERY_KEY environment variable is not configured correctly');
  }

  const user = await User.findById(userId).select('+encryptedPasswordRecovery');
  if (!user) {
    throw new Error('User not found');
  }

  if (!user.encryptedPasswordRecovery || !user.encryptedPasswordRecovery.ciphertext) {
    throw new Error('No encrypted password recovery data found for this user');
  }

  // Audit Log the sensitive action
  auditLog.passwordRecoveryAccessed(adminEmail, userId, reason);

  const key = Buffer.from(keyHex, 'hex');
  const { ciphertext, iv, authTag } = user.encryptedPasswordRecovery;

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}
