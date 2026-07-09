import { CryptoService } from './cryptoService';

class SecretStore {
  private privateKey: CryptoKey | null = null;
  private roomKeys: Map<string, { key: CryptoKey; accessedAt: number }> = new Map();
  private maxRoomKeys = 50;

  setPrivateKey(key: CryptoKey): void {
    this.privateKey = key;
  }

  getPrivateKey(): CryptoKey | null {
    return this.privateKey;
  }

  clearPrivateKey(): void {
    this.privateKey = null;
  }

  setRoomKey(roomId: string, key: CryptoKey): void {
    if (this.roomKeys.size >= this.maxRoomKeys) {
      // Find oldest accessed key to evict (LRU)
      let oldestRoomId: string | null = null;
      let oldestTime = Infinity;
      for (const [rId, entry] of this.roomKeys.entries()) {
        if (entry.accessedAt < oldestTime) {
          oldestTime = entry.accessedAt;
          oldestRoomId = rId;
        }
      }
      if (oldestRoomId) {
        this.roomKeys.delete(oldestRoomId);
      }
    }
    this.roomKeys.set(roomId, { key, accessedAt: Date.now() });
  }

  getRoomKey(roomId: string): CryptoKey | null {
    const entry = this.roomKeys.get(roomId);
    if (!entry) return null;
    entry.accessedAt = Date.now();
    return entry.key;
  }

  async getOrUnwrapRoomKey(roomId: string, encryptedKeyForMe?: string): Promise<CryptoKey | null> {
    let roomKey = this.getRoomKey(roomId);
    if (roomKey) return roomKey;

    if (!encryptedKeyForMe || !this.privateKey) {
      return null;
    }

    try {
      const roomKeyBase64 = await CryptoService.decryptRoomKey(encryptedKeyForMe, this.privateKey);
      roomKey = await CryptoService.importRoomKey(roomKeyBase64);
      this.setRoomKey(roomId, roomKey);
      return roomKey;
    } catch (err) {
      console.error('Failed to unwrap room key for room:', roomId, err);
      return null;
    }
  }

  clearAllRoomKeys(): void {
    this.roomKeys.clear();
  }

  clearAll(): void {
    this.clearPrivateKey();
    this.clearAllRoomKeys();
  }
}

export const secretStore = new SecretStore();
export default secretStore;
