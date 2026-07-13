import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks hosted on globalThis to bypass Vitest/ESM hoisting limits
const mockKeystore = new Map<string, { key: string; protectionLevel: string }>();
const mockEncryptedData = new Map<string, { ciphertext: string; iv: string; aad?: string }>();

const mockSecureKeyStore = {
  generateKey: vi.fn(async ({ alias }) => {
    mockKeystore.set(alias, { key: 'mock_keystore_aes_key', protectionLevel: 'TEE' });
    return { success: true, protectionLevel: 'TEE' };
  }),
  encrypt: vi.fn(async ({ alias, plaintext, aad }) => {
    if (!mockKeystore.has(alias)) throw new Error('Key not found');
    const ciphertext = `enc_${plaintext}`;
    const iv = 'mock_iv_base64';
    mockEncryptedData.set(alias, { ciphertext, iv, aad });
    return { ciphertext, iv };
  }),
  decrypt: vi.fn(async ({ alias, ciphertext, iv, aad }) => {
    if (!mockKeystore.has(alias)) {
      return { error: 'KEY_INVALIDATED' }; // Invalidation simulation
    }
    const data = mockEncryptedData.get(alias);
    if (!data || data.ciphertext !== ciphertext || data.iv !== iv) {
      return { error: 'KEY_INVALIDATED' }; // Corruption/tag mismatch
    }
    // Verify authenticated additional data (AAD)
    if (data.aad !== aad) {
      return { error: 'KEY_INVALIDATED' }; // AAD tampered simulation
    }
    const plaintext = ciphertext.replace('enc_', '');
    return { plaintext };
  }),
  deleteKey: vi.fn(async ({ alias }) => {
    mockKeystore.delete(alias);
    mockEncryptedData.delete(alias);
    return { success: true };
  }),
  hasKey: vi.fn(async ({ alias }) => {
    return { exists: mockKeystore.has(alias) };
  })
};

(globalThis as any).mockSecureKeyStore = mockSecureKeyStore;
(globalThis as any).mockIsNative = true;

vi.mock('@capacitor/core', () => {
  return {
    registerPlugin: () => ({
      generateKey: (args: any) => (globalThis as any).mockSecureKeyStore.generateKey(args),
      encrypt: (args: any) => (globalThis as any).mockSecureKeyStore.encrypt(args),
      decrypt: (args: any) => (globalThis as any).mockSecureKeyStore.decrypt(args),
      deleteKey: (args: any) => (globalThis as any).mockSecureKeyStore.deleteKey(args),
      hasKey: (args: any) => (globalThis as any).mockSecureKeyStore.hasKey(args),
    }),
    Capacitor: {
      isNativePlatform: () => (globalThis as any).mockIsNative,
      getPlatform: () => 'android',
    }
  };
});

// Import service AFTER vi.mock to ensure the mock is applied
import { SecureKeyWrapper } from '../services/secureKeyWrapper';
import { secretStore } from '../services/secretStore';
import { store } from '../store';
import { logoutUser, loginSuccess } from '../features/auth/authSlice';
import { CryptoService } from '../services/cryptoService';
import { canonicalDb } from '../services/CanonicalDatabase';
import { DatabaseBackupService } from '../services/DatabaseBackupService';

describe('E2EE Key Wrapping & Cold-Start Recovery', () => {
  const ACCOUNT = 'test-account-id';
  const IDENTITY_VER = 1;
  let privateKey: CryptoKey;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockKeystore.clear();
    mockEncryptedData.clear();
    secretStore.clearAll();
    (globalThis as any).mockIsNative = true;

    // Reset module session and active operations
    (SecureKeyWrapper as any).sessionGeneration = 0;
    (SecureKeyWrapper as any).activeOperations.clear();

    const keyPair = await CryptoService.generateUserKeyPair();
    privateKey = keyPair.privateKey;

    canonicalDb.setAccountId(ACCOUNT);
    await canonicalDb.open();
    // Wipe IndexedDB metadata
    const idb = await canonicalDb.open();
    const tx = idb.transaction('sync_meta', 'readwrite');
    tx.objectStore('sync_meta').clear();
    await new Promise<void>((resolve) => tx.oncomplete = () => resolve());
  });

  it('successfully wraps and unwraps the private key', async () => {
    // 1. Wrap key
    await SecureKeyWrapper.wrapAndStorePrivateKey(ACCOUNT, IDENTITY_VER, privateKey);
    expect(mockSecureKeyStore.generateKey).toHaveBeenCalled();
    expect(mockSecureKeyStore.encrypt).toHaveBeenCalled();

    // Verify metadata saved to IndexedDB sync_meta
    const record = await canonicalDb.get<any>('sync_meta', [ACCOUNT, 'wrapped_e2e_key']);
    expect(record).toBeDefined();
    expect(record.value.ciphertext).toContain('enc_');

    // 2. Clear secret store to simulate cold start
    secretStore.clearAll();
    expect(secretStore.getPrivateKey()).toBeNull();

    // 3. Unwrap key
    const res = await SecureKeyWrapper.unwrapAndLoadPrivateKey(ACCOUNT, IDENTITY_VER);
    expect(res).toBe('SUCCESS');
    expect(secretStore.getPrivateKey()).toBeDefined();
  });

  it('rejects unwrapping when identityVersion mismatch occurs', async () => {
    await SecureKeyWrapper.wrapAndStorePrivateKey(ACCOUNT, IDENTITY_VER, privateKey);

    secretStore.clearAll();

    // Attempt unwrap with wrong identityVersion
    const res = await SecureKeyWrapper.unwrapAndLoadPrivateKey(ACCOUNT, IDENTITY_VER + 1);
    expect(res).toBe('NO_KEY');
    expect(secretStore.getPrivateKey()).toBeNull();
  });

  it('rejects unwrapping when accountId mismatch occurs (account isolation)', async () => {
    await SecureKeyWrapper.wrapAndStorePrivateKey(ACCOUNT, IDENTITY_VER, privateKey);

    secretStore.clearAll();

    // Attempt unwrap as a different account B
    const res = await SecureKeyWrapper.unwrapAndLoadPrivateKey('different-account', IDENTITY_VER);
    expect(res).toBe('NO_KEY');
    expect(secretStore.getPrivateKey()).toBeNull();
  });

  it('returns KEY_INVALIDATED when AAD is tampered with', async () => {
    await SecureKeyWrapper.wrapAndStorePrivateKey(ACCOUNT, IDENTITY_VER, privateKey);

    secretStore.clearAll();

    // Spy on decrypt to inject tampered AAD
    const originalDecrypt = mockSecureKeyStore.decrypt;
    mockSecureKeyStore.decrypt = vi.fn(async (args) => {
      // Modify AAD to simulate tampering
      return originalDecrypt({ ...args, aad: 'tampered-aad-value' });
    });

    const res = await SecureKeyWrapper.unwrapAndLoadPrivateKey(ACCOUNT, IDENTITY_VER);
    expect(res).toBe('KEY_INVALIDATED');
    expect(secretStore.getPrivateKey()).toBeNull();

    // Restore original decrypt function
    mockSecureKeyStore.decrypt = originalDecrypt;
  });

  it('returns KEY_INVALIDATED when native key is permanently invalidated or missing', async () => {
    await SecureKeyWrapper.wrapAndStorePrivateKey(ACCOUNT, IDENTITY_VER, privateKey);

    secretStore.clearAll();

    // Clear keystore to simulate key invalidation/deletion
    mockKeystore.clear();

    const res = await SecureKeyWrapper.unwrapAndLoadPrivateKey(ACCOUNT, IDENTITY_VER);
    expect(res).toBe('KEY_INVALIDATED');
    expect(secretStore.getPrivateKey()).toBeNull();
  });

  it('returns KEY_INVALIDATED when ciphertext or IV is corrupted', async () => {
    await SecureKeyWrapper.wrapAndStorePrivateKey(ACCOUNT, IDENTITY_VER, privateKey);

    // Fetch meta from DB, corrupt it, and save it back
    const idb = await canonicalDb.open();
    const tx = idb.transaction('sync_meta', 'readwrite');
    const record: any = await new Promise((res) => {
      const req = tx.objectStore('sync_meta').get([ACCOUNT, 'wrapped_e2e_key']);
      req.onsuccess = () => res(req.result);
    });

    record.value.ciphertext = 'corrupted_ciphertext_data';
    tx.objectStore('sync_meta').put(record);
    await new Promise<void>((resolve) => tx.oncomplete = () => resolve());

    secretStore.clearAll();

    const res = await SecureKeyWrapper.unwrapAndLoadPrivateKey(ACCOUNT, IDENTITY_VER);
    expect(res).toBe('KEY_INVALIDATED');
    expect(secretStore.getPrivateKey()).toBeNull();
  });

  it('handles user migration: returns NO_KEY if metadata does not exist', async () => {
    const res = await SecureKeyWrapper.unwrapAndLoadPrivateKey(ACCOUNT, IDENTITY_VER);
    expect(res).toBe('NO_KEY');
    expect(secretStore.getPrivateKey()).toBeNull();
  });

  it('prevents concurrent unwrap attempts using single-flight mutex', async () => {
    await SecureKeyWrapper.wrapAndStorePrivateKey(ACCOUNT, IDENTITY_VER, privateKey);
    secretStore.clearAll();

    // Trigger multiple unwraps concurrently
    const p1 = SecureKeyWrapper.unwrapAndLoadPrivateKey(ACCOUNT, IDENTITY_VER);
    const p2 = SecureKeyWrapper.unwrapAndLoadPrivateKey(ACCOUNT, IDENTITY_VER);

    expect(p1).toBe(p2); // Must return the exact same promise instance!
    const results = await Promise.all([p1, p2]);
    expect(results[0]).toBe('SUCCESS');
    expect(results[1]).toBe('SUCCESS');
  });

  it('abort operations when session generation increments (logout/account switch during unwrap)', async () => {
    await SecureKeyWrapper.wrapAndStorePrivateKey(ACCOUNT, IDENTITY_VER, privateKey);
    secretStore.clearAll();

    const promise = SecureKeyWrapper.unwrapAndLoadPrivateKey(ACCOUNT, IDENTITY_VER);
    // Simulate immediate session increment (e.g. concurrent logout action)
    SecureKeyWrapper.incrementSession();

    const res = await promise;
    expect(res).toBe('ERROR');
    expect(secretStore.getPrivateKey()).toBeNull(); // Private key must NOT be loaded
  });

  it('removes native key and DB metadata on clearWrappedKey cleanup', async () => {
    await SecureKeyWrapper.wrapAndStorePrivateKey(ACCOUNT, IDENTITY_VER, privateKey);
    expect(mockKeystore.size).toBe(1);

    await SecureKeyWrapper.clearWrappedKey(ACCOUNT);
    expect(mockKeystore.size).toBe(0);

    const record = await canonicalDb.get<any>('sync_meta', [ACCOUNT, 'wrapped_e2e_key']);
    expect(record).toBeUndefined();
  });

  it('never includes wrapped key metadata or alias in database backup exports', async () => {
    await SecureKeyWrapper.wrapAndStorePrivateKey(ACCOUNT, IDENTITY_VER, privateKey);

    // Run exportBackup
    const backupService = new DatabaseBackupService(canonicalDb);
    const backupJsonStr = await backupService.exportBackup();
    
    expect(backupJsonStr).not.toContain('wrapped_e2e_key');
    expect(backupJsonStr).not.toContain('com.securechat.pwa.wrapkey');
  });

  it('prevents account-switch race during rapid Account A logout -> Account B login', async () => {
    // 1. Log in Account A, wrap its key, and verify it exists
    store.dispatch(loginSuccess({ user: { _id: 'account-a', firstName: 'A', lastName: 'User', email: 'a@test.com' }, token: 'token-a' }));
    await SecureKeyWrapper.wrapAndStorePrivateKey('account-a', 1, privateKey);
    expect(mockKeystore.has((SecureKeyWrapper as any).getAlias('account-a'))).toBe(true);

    // 2. Dispatch logoutUser for Account A, but delay the cleanup completion to simulate a slow platform
    const originalDeleteKey = mockSecureKeyStore.deleteKey;
    let deleteKeyResolve: any = null;
    const deleteKeyPromise = new Promise<void>((resolve) => deleteKeyResolve = resolve);
    
    mockSecureKeyStore.deleteKey = vi.fn(async (args) => {
      await deleteKeyPromise;
      return originalDeleteKey(args);
    });

    // We start logout for Account A
    const logoutPromise = store.dispatch(logoutUser() as any);

    // 3. Immediately log in Account B, generate/wrap its key
    // At this moment, Account A's cleanup is in-flight but not completed.
    await SecureKeyWrapper.wrapAndStorePrivateKey('account-b', 1, privateKey);

    // 4. Resolve the Account A cleanup delay
    if (deleteKeyResolve) deleteKeyResolve();
    await logoutPromise;

    // 5. Verify Account B's key and metadata are completely untouched and valid!
    expect(mockKeystore.has((SecureKeyWrapper as any).getAlias('account-b'))).toBe(true);
    expect(mockKeystore.has((SecureKeyWrapper as any).getAlias('account-a'))).toBe(false);

    // Restore original deleteKey
    mockSecureKeyStore.deleteKey = originalDeleteKey;
  });
});
