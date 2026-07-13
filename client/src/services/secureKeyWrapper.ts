import { registerPlugin, Capacitor } from '@capacitor/core';
import { CryptoService } from './cryptoService';
import { secretStore } from './secretStore';
import { canonicalDb } from './CanonicalDatabase';

const SecureKeyStore = registerPlugin<any>('SecureKeyStore');

export interface WrappedKeyMetadata {
  version: number;
  accountId: string;
  identityVersion: number;
  ciphertext: string;
  iv: string;
  algo: string;
  alias: string;
  createdAt: string;
  protectionLevel: 'SOFTWARE' | 'TEE' | 'STRONGBOX';
}

export class SecureKeyWrapper {
  private static sessionGeneration = 0;
  private static activeOperations: Map<string, Promise<any>> = new Map();
  private static SCHEMA_VERSION = 1;

  static incrementSession() {
    this.sessionGeneration++;
    console.log('[SecureKeyWrapper] Session generation incremented to:', this.sessionGeneration);
  }

  static getSessionGeneration() {
    return this.sessionGeneration;
  }

  private static getAlias(accountId: string): string {
    // Collision-resistant alias derived from opaque account identifier plus app namespace. No PII.
    return `com.securechat.pwa.wrapkey.${accountId}`;
  }

  static wrapAndStorePrivateKey(accountId: string, identityVersion: number, privateKey: CryptoKey): Promise<void> {
    const opKey = `wrap_${accountId}`;
    const existing = this.activeOperations.get(opKey);
    if (existing) return existing;

    const promise = (async () => {
      const startGen = this.sessionGeneration;
      try {
        const isNative = Capacitor.isNativePlatform();
        if (!isNative) return;

        const alias = this.getAlias(accountId);
        const privateKeyStr = await CryptoService.exportPrivateKey(privateKey);

        // 1. Generate key in Keystore
        const genResult = await SecureKeyStore.generateKey({ alias });
        const protectionLevel = genResult?.protectionLevel || 'TEE';

        // 2. Encrypt E2E private key with AES-GCM and bind via AAD
        const aad = `${accountId}|${identityVersion}|${this.SCHEMA_VERSION}|${alias}`;
        const encryptResult = await SecureKeyStore.encrypt({
          alias,
          plaintext: privateKeyStr,
          aad
        });

        if (!encryptResult || !encryptResult.ciphertext || !encryptResult.iv) {
          throw new Error('Keystore encryption failed');
        }

        // Session check before writing
        if (this.sessionGeneration !== startGen) {
          console.warn('[SecureKeyWrapper] Session changed mid-wrap. Aborting write.');
          return;
        }

        const meta: WrappedKeyMetadata = {
          version: this.SCHEMA_VERSION,
          accountId,
          identityVersion,
          ciphertext: encryptResult.ciphertext,
          iv: encryptResult.iv,
          algo: 'AES-GCM-256',
          alias,
          createdAt: new Date().toISOString(),
          protectionLevel,
        };

        // Save metadata to IndexedDB sync_meta store
        const idb = await canonicalDb.open();
        const tx = idb.transaction('sync_meta', 'readwrite');
        tx.objectStore('sync_meta').put({
          accountId,
          key: 'wrapped_e2e_key',
          value: meta,
        });

        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });

        console.log('[SecureKeyWrapper] Wrapped E2E private key stored successfully in IndexedDB (sync_meta)');
      } catch (err) {
        console.error('[SecureKeyWrapper] wrapAndStorePrivateKey failed:', err);
      } finally {
        this.activeOperations.delete(opKey);
      }
    })();

    this.activeOperations.set(opKey, promise);
    return promise;
  }

  static unwrapAndLoadPrivateKey(accountId: string, identityVersion: number): Promise<'SUCCESS' | 'NO_KEY' | 'KEY_INVALIDATED' | 'ERROR'> {
    const opKey = `unwrap_${accountId}`;
    const existing = this.activeOperations.get(opKey);
    if (existing) return existing;

    const promise = (async () => {
      const startGen = this.sessionGeneration;
      try {
        const isNative = Capacitor.isNativePlatform();
        if (!isNative) return 'NO_KEY';

        // 1. Fetch metadata from IndexedDB sync_meta store
        const idb = await canonicalDb.open();
        const tx = idb.transaction('sync_meta', 'readonly');
        const record: any = await new Promise((resolve) => {
          const req = tx.objectStore('sync_meta').get([accountId, 'wrapped_e2e_key']);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });

        if (!record || !record.value) {
          console.log('[SecureKeyWrapper] No wrapped key metadata found in IndexedDB.');
          return 'NO_KEY';
        }

        const meta: WrappedKeyMetadata = record.value;

        // Reject stale blobs after identity reset or account mismatch
        if (meta.accountId !== accountId || meta.identityVersion !== identityVersion) {
          console.warn('[SecureKeyWrapper] Identity version or account mismatch. Rejecting wrapped key metadata.');
          this.clearWrappedKey(accountId).catch(() => {});
          return 'NO_KEY';
        }

        // Decrypt using Keystore with verified AAD
        const alias = this.getAlias(accountId);
        const aad = `${accountId}|${identityVersion}|${this.SCHEMA_VERSION}|${alias}`;

        const decryptResult = await SecureKeyStore.decrypt({
          alias,
          ciphertext: meta.ciphertext,
          iv: meta.iv,
          aad
        });

        if (decryptResult && decryptResult.error === 'KEY_INVALIDATED') {
          console.warn('[SecureKeyWrapper] Native key permanently invalidated or lock screen changed.');
          return 'KEY_INVALIDATED';
        }

        if (!decryptResult || !decryptResult.plaintext) {
          throw new Error('Keystore decryption returned empty plaintext');
        }

        // Session check before load
        if (this.sessionGeneration !== startGen) {
          console.warn('[SecureKeyWrapper] Session changed mid-unwrap. Aborting load.');
          return 'ERROR';
        }

        const privateKey = await CryptoService.importPrivateKey(decryptResult.plaintext);
        secretStore.setPrivateKey(privateKey);
        console.log('[SecureKeyWrapper] Wrapped E2E private key successfully unwrapped and loaded into secretStore.');
        return 'SUCCESS';
      } catch (err: any) {
        console.error('[SecureKeyWrapper] unwrapAndLoadPrivateKey failed:', err);
        const errStr = err?.message || '';
        if (errStr.includes('invalidated') || errStr.includes('permanently') || errStr.includes('UserNotAuthenticated') || errStr.includes('BadTag') || errStr.includes('mac failed')) {
          return 'KEY_INVALIDATED';
        }
        return 'ERROR';
      } finally {
        this.activeOperations.delete(opKey);
      }
    })();

    this.activeOperations.set(opKey, promise);
    return promise;
  }

  static clearWrappedKey(accountId: string): Promise<void> {
    const opKey = `clear_${accountId}`;
    const existing = this.activeOperations.get(opKey);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const isNative = Capacitor.isNativePlatform();
        if (isNative) {
          const alias = this.getAlias(accountId);
          await SecureKeyStore.deleteKey({ alias });
        }
        // Purge metadata from IndexedDB
        const idb = await canonicalDb.open();
        if (idb.objectStoreNames.contains('sync_meta')) {
          const tx = idb.transaction('sync_meta', 'readwrite');
          tx.objectStore('sync_meta').delete([accountId, 'wrapped_e2e_key']);
          await new Promise<void>((resolve) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          });
        }
        console.log('[SecureKeyWrapper] Cleared wrapped key and metadata for account:', accountId);
      } catch (err) {
        console.error('[SecureKeyWrapper] clearWrappedKey failed:', err);
      } finally {
        this.activeOperations.delete(opKey);
      }
    })();

    this.activeOperations.set(opKey, promise);
    return promise;
  }
}
