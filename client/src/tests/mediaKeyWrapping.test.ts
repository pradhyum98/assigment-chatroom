import { describe, it, expect } from 'vitest';
import { CryptoService } from '../services/cryptoService';

describe('E2EE Media Key Wrapping (Version 2)', () => {
  it('successfully wraps, unwraps, and verifies correctness of E2EE media key', async () => {
    const roomId = 'room-uuid-12345';
    const clientMsgId = 'msg-uuid-67890';
    const context = { roomId, clientMsgId, encryptionVersion: 2 as const };

    // 1. Generate keys
    const roomKey = await CryptoService.generateRoomKey();
    const mediaKey = await CryptoService.generateRoomKey(); // Generate standard AES key for media

    // 2. Wrap media key
    const { wrappedKey, wrapIv } = await CryptoService.wrapMediaKey(mediaKey, roomKey, context);
    expect(wrappedKey).toBeDefined();
    expect(wrapIv).toBeDefined();

    // 3. Unwrap media key using identical context
    const unwrappedMediaKey = await CryptoService.unwrapMediaKey(wrappedKey, wrapIv, roomKey, context);
    expect(unwrappedMediaKey).toBeDefined();
    expect(unwrappedMediaKey.type).toBe('secret');

    // 4. Verify unwrapped key works by encrypting and decrypting a small payload
    const text = 'Secure file bytes mock';
    const enc = new TextEncoder().encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt with original media key
    const cipher = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, mediaKey, enc);

    // Decrypt with unwrapped media key
    const plain = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, unwrappedMediaKey, cipher);
    const decryptedText = new TextDecoder().decode(plain);
    expect(decryptedText).toBe(text);
  });

  it('fails to unwrap media key if roomId is mismatched (Aead tag mismatch)', async () => {
    const roomId = 'room-uuid-12345';
    const clientMsgId = 'msg-uuid-67890';
    
    const roomKey = await CryptoService.generateRoomKey();
    const mediaKey = await CryptoService.generateRoomKey();

    const { wrappedKey, wrapIv } = await CryptoService.wrapMediaKey(mediaKey, roomKey, {
      roomId,
      clientMsgId,
      encryptionVersion: 2
    });

    // Attempt to unwrap with a different roomId
    await expect(
      CryptoService.unwrapMediaKey(wrappedKey, wrapIv, roomKey, {
        roomId: 'tampered-room-id',
        clientMsgId,
        encryptionVersion: 2
      })
    ).rejects.toThrow();
  });

  it('fails to unwrap media key if clientMsgId is mismatched (Aead tag mismatch)', async () => {
    const roomId = 'room-uuid-12345';
    const clientMsgId = 'msg-uuid-67890';
    
    const roomKey = await CryptoService.generateRoomKey();
    const mediaKey = await CryptoService.generateRoomKey();

    const { wrappedKey, wrapIv } = await CryptoService.wrapMediaKey(mediaKey, roomKey, {
      roomId,
      clientMsgId,
      encryptionVersion: 2
    });

    // Attempt to unwrap with a different clientMsgId
    await expect(
      CryptoService.unwrapMediaKey(wrappedKey, wrapIv, roomKey, {
        roomId,
        clientMsgId: 'tampered-msg-id',
        encryptionVersion: 2
      })
    ).rejects.toThrow();
  });
});
