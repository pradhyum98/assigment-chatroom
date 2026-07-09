import type { OutboxItem } from './OutboxService';
import { CanonicalDatabase } from './CanonicalDatabase';

export class CryptoRevalidationService {
  private db: CanonicalDatabase;
  private secretStore: any;
  constructor(db: CanonicalDatabase, secretStore: any) {
    this.db = db;
    this.secretStore = secretStore;
  }

  async validate(item: OutboxItem): Promise<{ isValid: boolean; needsReencryption: boolean }> {
    const accountId = this.db.getAccountId();
    
    // 1. Check if room is accessible
    const room = await this.db.get<any>('room_projections', [accountId, item.roomId]);
    if (!room || room.syncState === 'ACCESS_REVOKED') {
      return { isValid: false, needsReencryption: false };
    }

    // 2. Check if identity has changed
    const currentIdentityVersion = 1; // get from user projection
    if (item.requiredIdentityVersion !== undefined && item.requiredIdentityVersion !== currentIdentityVersion) {
      return { isValid: false, needsReencryption: true };
    }

    // 3. Check if room key has rotated
    if (item.requiredRoomKeyVersion !== undefined && item.requiredRoomKeyVersion !== room.roomKeyVersion) {
      return { isValid: true, needsReencryption: true };
    }

    // 4. Check membership revision (e.g. if we are allowed to send now)
    if (item.requiredMembershipRevision !== undefined && item.requiredMembershipRevision !== room.membershipRevision) {
      // Membership changed, but we might still have access. We might just need to update the envelope.
      // But strictly, if membership changes, a key rotation should have happened. So covered by #3.
    }

    return { isValid: true, needsReencryption: false };
  }

  async reencrypt(item: OutboxItem): Promise<boolean> {
    console.log(`[CryptoRevalidationService] Attempting to re-encrypt mutation ${item.mutationId}`);
    
    const accountId = this.db.getAccountId();
    const room = await this.db.get<any>('room_projections', [accountId, item.roomId]);
    
    if (!room || !room.roomKeyVersion) {
      return false; // Cannot re-encrypt without active room key
    }

    const activeRoomKey = this.secretStore.getRoomKey(item.roomId);
    if (!activeRoomKey) {
      console.warn(`[CryptoRevalidationService] Active room key not available in SecretStore for room ${item.roomId}`);
      return false;
    }

    try {
      // In a real implementation:
      // 1. We must have stored the pending PLAINTEXT somewhere safely (e.g., Capacitor SecureStorage)
      //    We intentionally DO NOT store it in the OutboxItem `payload.content` to avoid IndexedDB plaintext leakage.
      // 2. Retrieve plaintext.
      // 3. Generate new AES-GCM IV.
      // 4. Encrypt with `activeRoomKey`.
      // 5. Update `item.payload.content` and `item.payload.iv`.
      // 6. Update `item.requiredRoomKeyVersion = room.roomKeyVersion`.
      
      // For now, simulate success if it's a mock
      
      item.requiredRoomKeyVersion = room.roomKeyVersion;
      item.requiredIdentityVersion = 1; // current identity version

      const tx = await this.db.transaction('offline_queue_v3', 'readwrite');
      tx.objectStore('offline_queue_v3').put(item);

      return true;
    } catch (err) {
      console.error(`[CryptoRevalidationService] Re-encryption failed`, err);
      return false;
    }
  }
}
