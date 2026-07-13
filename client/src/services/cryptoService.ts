/**
 * cryptoService.ts
 * Implements client-side E2EE using the Web Crypto API.
 * - RSA-OAEP for User Identity Keys.
 * - AES-GCM for Room Keys and Message content.
 */

const RSA_ALGO = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

const AES_ALGO = {
  name: 'AES-GCM',
  length: 256,
};

export class CryptoService {
  // ── User Identity Keys (RSA) ────────────────────────────────────────────────

  static async generateUserKeyPair(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
    return await window.crypto.subtle.generateKey(RSA_ALGO, true, ['encrypt', 'decrypt']);
  }

  static async exportPublicKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey('spki', key);
    return this.bufferToBase64(exported);
  }

  static async importPublicKey(base64Str: string): Promise<CryptoKey> {
    const binaryDerString = window.atob(base64Str);
    const binaryDer = this.stringToArrayBuffer(binaryDerString);

    return await window.crypto.subtle.importKey('spki', binaryDer, RSA_ALGO, true, ['encrypt']);
  }

  static async exportPrivateKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey('pkcs8', key);
    return this.bufferToBase64(exported);
  }

  static async importPrivateKey(base64Str: string): Promise<CryptoKey> {
    const binaryDerString = window.atob(base64Str);
    const binaryDer = this.stringToArrayBuffer(binaryDerString);

    return await window.crypto.subtle.importKey('pkcs8', binaryDer, RSA_ALGO, true, ['decrypt']);
  }

  // ── Room Keys (AES-GCM) ─────────────────────────────────────────────────────

  static async generateRoomKey(): Promise<CryptoKey> {
    return await window.crypto.subtle.generateKey(AES_ALGO, true, ['encrypt', 'decrypt']);
  }

  static async exportRoomKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey('raw', key);
    return this.bufferToBase64(exported);
  }

  static async importRoomKey(base64Str: string): Promise<CryptoKey> {
    const raw = this.stringToArrayBuffer(window.atob(base64Str));
    return await window.crypto.subtle.importKey('raw', raw, AES_ALGO, true, ['encrypt', 'decrypt']);
  }

  // ── Key Wrapping (Encrypting Room Key with RSA) ─────────────────────────────

  static async encryptRoomKeyForUser(roomKeyBase64: string, userPublicKeyBase64: string): Promise<string> {
    const publicKey = await this.importPublicKey(userPublicKeyBase64);
    const encodedRoomKey = new TextEncoder().encode(roomKeyBase64);
    const encryptedBuffer = await window.crypto.subtle.encrypt(RSA_ALGO, publicKey, encodedRoomKey);
    return this.bufferToBase64(encryptedBuffer);
  }

  static async decryptRoomKey(encryptedRoomKeyBase64: string, privateKey: CryptoKey): Promise<string> {
    const encryptedBuffer = this.stringToArrayBuffer(window.atob(encryptedRoomKeyBase64));
    const decryptedBuffer = await window.crypto.subtle.decrypt(RSA_ALGO, privateKey, encryptedBuffer);
    return new TextDecoder().decode(decryptedBuffer);
  }

  // ── Message Encryption (AES-GCM) ────────────────────────────────────────────

  static async encryptMessage(plaintext: string, roomKey: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedText = new TextEncoder().encode(plaintext);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      roomKey,
      encodedText
    );

    return {
      ciphertext: this.bufferToBase64(ciphertextBuffer),
      iv: this.bufferToBase64(iv.buffer),
    };
  }

  static async decryptMessage(ciphertextBase64: string, ivBase64: string, roomKey: CryptoKey): Promise<string> {
    const iv = new Uint8Array(this.stringToArrayBuffer(window.atob(ivBase64)));
    const ciphertext = this.stringToArrayBuffer(window.atob(ciphertextBase64));

    try {
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        roomKey,
        ciphertext
      );
      return new TextDecoder().decode(decryptedBuffer);
    } catch (err) {
      console.error('Decryption failed:', err);
      return '[Encrypted Message]';
    }
  }

  // ── PBKDF2 Key Derivation (Private Key Protection) ──────────────────────────

  static async deriveKeyFromPassword(password: string, salt: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    return await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode(salt),
        iterations: 600000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  static async encryptPrivateKeyWithPassword(privateKeyBase64: string, password: string, salt: string): Promise<{ ciphertext: string, iv: string }> {
    const key = await this.deriveKeyFromPassword(password, salt);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedText = new TextEncoder().encode(privateKeyBase64);
    
    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encodedText
    );
    
    return {
      ciphertext: this.bufferToBase64(ciphertextBuffer),
      iv: this.bufferToBase64(iv.buffer)
    };
  }

  static async decryptPrivateKeyWithPassword(encryptedData: { ciphertext: string, iv: string }, password: string, salt: string): Promise<string> {
    const key = await this.deriveKeyFromPassword(password, salt);
    const iv = new Uint8Array(this.stringToArrayBuffer(window.atob(encryptedData.iv)));
    const ciphertext = this.stringToArrayBuffer(window.atob(encryptedData.ciphertext));
    
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    
    return new TextDecoder().decode(decryptedBuffer);
  }

  // ── File Encryption (AES-GCM) ───────────────────────────────────────────────
  
  static async encryptFile(fileOrBuffer: File | ArrayBuffer): Promise<{ encryptedBlob: Blob, fileKey: CryptoKey, ivBase64: string }> {
    const fileKey = await this.generateRoomKey(); 
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    const arrayBuffer = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
    
    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      fileKey,
      arrayBuffer
    );
    
    return {
      encryptedBlob: new Blob([ciphertextBuffer], { type: 'application/octet-stream' }),
      fileKey,
      ivBase64: this.bufferToBase64(iv.buffer)
    };
  }

  static async decryptFile(
    encryptedBlob: Blob,
    fileKeyOrBase64: CryptoKey | string,
    ivBase64: string,
    mimeType: string
  ): Promise<string> {
    const fileKey = typeof fileKeyOrBase64 === 'string'
      ? await this.importRoomKey(fileKeyOrBase64)
      : fileKeyOrBase64;
    const iv = new Uint8Array(this.stringToArrayBuffer(window.atob(ivBase64)));
    const arrayBuffer = await encryptedBlob.arrayBuffer();
    
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      fileKey,
      arrayBuffer
    );
    
    const decryptedBlob = new Blob([decryptedBuffer], { type: mimeType });
    return URL.createObjectURL(decryptedBlob);
  }

  // ── Key Wrapping (AES-GCM with context bound additionalData) ────────────────

  static async wrapMediaKey(
    mediaKey: CryptoKey,
    roomKey: CryptoKey,
    context: { roomId: string; clientMsgId: string; encryptionVersion: 2 }
  ): Promise<{ wrappedKey: string; wrapIv: string }> {
    const rawMediaKey = await window.crypto.subtle.exportKey('raw', mediaKey);
    const wrapIv = window.crypto.getRandomValues(new Uint8Array(12));
    
    const additionalDataText = `${context.encryptionVersion}:${context.roomId}:${context.clientMsgId}`;
    const additionalData = new TextEncoder().encode(additionalDataText);

    const wrappedBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: wrapIv, additionalData },
      roomKey,
      rawMediaKey
    );

    // Securely clear raw bytes array
    const rawBytesArray = new Uint8Array(rawMediaKey);
    rawBytesArray.fill(0);

    return {
      wrappedKey: this.bufferToBase64(wrappedBuffer),
      wrapIv: this.bufferToBase64(wrapIv.buffer)
    };
  }

  static async unwrapMediaKey(
    wrappedKeyBase64: string,
    wrapIvBase64: string,
    roomKey: CryptoKey,
    context: { roomId: string; clientMsgId: string; encryptionVersion: 2 }
  ): Promise<CryptoKey> {
    const wrapIv = new Uint8Array(this.stringToArrayBuffer(window.atob(wrapIvBase64)));
    const ciphertext = this.stringToArrayBuffer(window.atob(wrappedKeyBase64));

    const additionalDataText = `${context.encryptionVersion}:${context.roomId}:${context.clientMsgId}`;
    const additionalData = new TextEncoder().encode(additionalDataText);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: wrapIv, additionalData },
      roomKey,
      ciphertext
    );

    const rawKey = new Uint8Array(decryptedBuffer);
    const importedKey = await window.crypto.subtle.importKey(
      'raw',
      rawKey.buffer,
      AES_ALGO,
      true,
      ['encrypt', 'decrypt']
    );

    // Clear key material bytes
    rawKey.fill(0);

    return importedKey;
  }

  // ── Utils ───────────────────────────────────────────────────────────────────

  private static bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private static stringToArrayBuffer(str: string): ArrayBuffer {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
      bufView[i] = str.charCodeAt(i);
    }
    return buf;
  }
}
