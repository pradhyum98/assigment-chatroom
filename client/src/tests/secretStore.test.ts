import { describe, it, expect, beforeEach } from 'vitest';
import { secretStore } from '../services/secretStore';
import { CryptoService } from '../services/cryptoService';

describe('SecretStore', () => {
  beforeEach(() => {
    secretStore.clearAll();
  });

  it('securely stores and retrieves the private key in memory', async () => {
    const keyPair = await CryptoService.generateUserKeyPair();
    secretStore.setPrivateKey(keyPair.privateKey);

    const retrievedKey = secretStore.getPrivateKey();
    expect(retrievedKey).toBeDefined();
    expect(retrievedKey?.type).toBe('private');
  });

  it('securely stores and retrieves room keys in memory', async () => {
    const roomKey = await CryptoService.generateRoomKey();
    secretStore.setRoomKey('room-123', roomKey);

    const retrievedKey = secretStore.getRoomKey('room-123');
    expect(retrievedKey).toBeDefined();
    expect(retrievedKey?.type).toBe('secret');
  });

  it('evicts oldest room keys when limit is reached', async () => {
    // Generate 51 keys (limit is 50)
    for (let i = 1; i <= 51; i++) {
      const roomKey = await CryptoService.generateRoomKey();
      secretStore.setRoomKey(`room-${i}`, roomKey);
    }

    // room-1 should be evicted since it was added first and not accessed
    expect(secretStore.getRoomKey('room-1')).toBeNull();
    // room-51 should exist
    expect(secretStore.getRoomKey('room-51')).toBeDefined();
  });

  it('clears all keys from memory', async () => {
    const keyPair = await CryptoService.generateUserKeyPair();
    const roomKey = await CryptoService.generateRoomKey();

    secretStore.setPrivateKey(keyPair.privateKey);
    secretStore.setRoomKey('room-123', roomKey);

    secretStore.clearAll();

    expect(secretStore.getPrivateKey()).toBeNull();
    expect(secretStore.getRoomKey('room-123')).toBeNull();
  });

  it('unwraps a room key and stores it when not cached', async () => {
    const userKeyPair = await CryptoService.generateUserKeyPair();
    secretStore.setPrivateKey(userKeyPair.privateKey);

    const originalRoomKey = await CryptoService.generateRoomKey();
    const originalRoomKeyBase64 = await CryptoService.exportRoomKey(originalRoomKey);
    
    const userPublicKeyBase64 = await CryptoService.exportPublicKey(userKeyPair.publicKey);
    const encryptedKeyForMe = await CryptoService.encryptRoomKeyForUser(originalRoomKeyBase64, userPublicKeyBase64);

    const unwrappedKey = await secretStore.getOrUnwrapRoomKey('room-new', encryptedKeyForMe);
    expect(unwrappedKey).toBeDefined();
    expect(unwrappedKey?.type).toBe('secret');

    // It should now be cached
    expect(secretStore.getRoomKey('room-new')).toBeDefined();
  });
});
