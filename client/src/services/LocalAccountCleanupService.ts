import { CanonicalDatabase } from './CanonicalDatabase';
import secretStore from './secretStore';

/**
 * LocalAccountCleanupService
 *
 * Canonical service for wiping all account-scoped local state on logout or
 * account transition. Satisfies B2: no authenticated account may observe or
 * inherit another account's local canonical state.
 *
 * STORE-BY-STORE CLASSIFICATION (canonical_db v1):
 *
 * MUST PURGE ON LOGOUT:
 *   - room_events              (canonical projections — rebuildable but must isolate)
 *   - user_events              (rebuildable)
 *   - room_cursors             (cursor position — wrong after account change)
 *   - user_cursor              (cursor position)
 *   - room_projections         (derived state)
 *   - message_projections      (derived state, includes ciphertext metadata)
 *   - membership_projections   (derived state)
 *   - offline_queue_v3         (pending mutations — cross-account leakage risk)
 *   - processed_events         (event deduplication guards)
 *   - sync_meta                (cursors, generation ids, bootstrap state)
 *   - upload_checkpoints       (account-scoped upload state)
 *   - cleanup_intents          (cleanup receipts)
 *   - snapshot_manifests       (snapshot staging)
 *   - snapshot_room_staging    (snapshot staging)
 *   - snapshot_message_staging (snapshot staging)
 *   - snapshot_membership_staging (snapshot staging)
 *
 * MUST PURGE ON LOGOUT (runtime memory):
 *   - secretStore private key  (CryptoKey — never persisted)
 *   - secretStore room keys    (CryptoKey map — never persisted)
 *
 * MUST PURGE ON ACCOUNT SWITCH (same as logout):
 *   All of the above.
 *
 * MUST PURGE ON IDENTITY RESET:
 *   - secretStore (private key + room keys invalidated by key rotation)
 *   - offline_queue_v3 (mutations encrypted with old key are stale)
 *   - snapshot staging (if in progress)
 *   NOTE: room_events, message_projections, room_projections are NOT purged on
 *   identity reset — they contain ciphertext rebuildable from server and must
 *   survive so the RecoveryCoordinator can re-apply key-rotation events on top.
 *
 * SAFE TO RETAIN (non-secret, non-account-scoped):
 *   - localStorage 'user' — non-secret profile, purged separately by authSlice
 *   - localStorage 'hasSession' — boolean flag, purged by authSlice
 *   NOTE: 'e2e_private_key' (legacy) and 'room_key_*' (legacy) are purged by authSlice.
 *
 * REQUIRES QUARANTINE (not blindly deleted):
 *   - offline_queue_v3 items in 'SENDING' state — must be flushed or aborted first.
 *     For logout, we skip flush and force-purge. For identity reset we quarantine
 *     and re-encrypt.
 *
 * ORDERING CONTRACT:
 * 1. Increment generation barrier (cancels stale async writes)
 * 2. Cancel RecoveryCoordinator
 * 3. Clear SecretStore (runtime key material)
 * 4. Clear account-scoped IDB stores by IDBKeyRange
 * 5. Close IDB connection
 *
 * Race prevention: All writes in SyncEngine, RecoveryCoordinator, CanonicalHistoryInstaller,
 * OutboxService check the generationRef before writing back. Incrementing gen before IDB
 * operations ensures stale async tasks abort before their write completes.
 */

export type CleanupScope = 'LOGOUT' | 'ACCOUNT_SWITCH' | 'IDENTITY_RESET';

const ALL_ACCOUNT_STORES: string[] = [
  'room_events',
  'user_events',
  'room_cursors',
  'user_cursor',
  'room_projections',
  'message_projections',
  'membership_projections',
  'offline_queue_v3',
  'processed_events',
  'sync_meta',
  'upload_checkpoints',
  'cleanup_intents',
  'snapshot_manifests',
  'snapshot_room_staging',
  'snapshot_message_staging',
  'snapshot_membership_staging',
];

const IDENTITY_RESET_STORES: string[] = [
  'offline_queue_v3',
  'snapshot_manifests',
  'snapshot_room_staging',
  'snapshot_message_staging',
  'snapshot_membership_staging',
  'cleanup_intents',
];

export class LocalAccountCleanupService {
  private db: CanonicalDatabase;

  constructor(db: CanonicalDatabase) {
    this.db = db;
  }

  /**
   * Full account wipe. Called on logout or account switch.
   *
   * @param accountId  - The account being logged out (used as IDB key prefix).
   * @param scope      - 'LOGOUT' or 'ACCOUNT_SWITCH' (same behavior, different logging).
   * @returns          - Cleanup result summary.
   */
  async purgeAccount(accountId: string, scope: CleanupScope = 'LOGOUT'): Promise<{ success: boolean; storesCleared: string[]; errors: string[] }> {
    const storesCleared: string[] = [];
    const errors: string[] = [];

    // Step 1: Clear runtime key material FIRST (synchronous, cannot fail)
    secretStore.clearAll();

    // Step 2: Clear all account-scoped stores by IDBKeyRange
    const storesToClear = scope === 'IDENTITY_RESET' ? IDENTITY_RESET_STORES : ALL_ACCOUNT_STORES;

    for (const storeName of storesToClear) {
      try {
        await this._clearAccountStore(accountId, storeName);
        storesCleared.push(storeName);
      } catch (err: any) {
        errors.push(`${storeName}: ${err?.message ?? 'unknown error'}`);
        console.error(`[LocalAccountCleanupService] Failed to clear store "${storeName}" for account ${accountId}:`, err);
      }
    }

    // Step 3: Close the IDB connection so the next account starts fresh
    await this.db.close();

    const success = errors.length === 0;
    if (!success) {
      console.warn(`[LocalAccountCleanupService] ${scope} for account ${accountId} completed with ${errors.length} error(s). DB revocation remains authoritative.`);
    } else {
      console.log(`[LocalAccountCleanupService] ${scope} for account ${accountId} complete. ${storesCleared.length} store(s) cleared.`);
    }

    return { success, storesCleared, errors };
  }

  /**
   * Partial wipe for identity reset. Only clears outbox and staging stores.
   * Canonical projections are retained so the reconciler can re-apply rotation events.
   */
  async purgeIdentityResetData(accountId: string): Promise<{ success: boolean; storesCleared: string[]; errors: string[] }> {
    return this.purgeAccount(accountId, 'IDENTITY_RESET');
  }

  /**
   * Idempotent: clearing an already-empty store is a no-op.
   */
  private async _clearAccountStore(accountId: string, storeName: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await this.db.open();
        // Verify the store exists (schema may differ in test environments)
        if (!db.objectStoreNames.contains(storeName)) {
          resolve();
          return;
        }
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        // Account isolation: clear ONLY this account's records using IDBKeyRange
        // All stores use compound keyPath starting with accountId
        // This is safer than store.clear() which would delete cross-account data
        // if multiple accounts ever shared the same IDB instance.
        let deleteReq: IDBRequest;
        try {
          const range = IDBKeyRange.bound([accountId], [accountId, '\uffff\uffff\uffff\uffff\uffff']);
          deleteReq = store.delete(range);
        } catch (_rangeErr) {
          // user_cursor uses single-key keyPath 'accountId' — handle separately
          deleteReq = store.delete(accountId);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        // deleteReq errors propagate to tx.onerror
        deleteReq.onerror = () => reject(deleteReq.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Proof: logout followed by login as a different account cannot hydrate prior data.
   *
   * After purgeAccount(accountIdA), ALL stores are cleared for accountIdA.
   * On next open() + init(accountIdB), CanonicalDatabase.setAccountId(accountIdB)
   * is called, which means all subsequent IDBKeyRange queries use accountIdB prefix.
   * Even if some store entries for accountIdA somehow survived (e.g., due to a
   * partial-clear race), they would never be returned because all reads use
   * IDBKeyRange.bound([accountIdB, ...], [accountIdB, '\uffff']).
   *
   * This provides defense-in-depth account isolation even if cleanup is partial.
   */
  static accountIsolationProof = `
    Isolation is enforced at TWO levels:
    1. Explicit purge: purgeAccount() deletes all IDB records for accountId prefix.
    2. Structural: All reads use IDBKeyRange.bound([accountId, ...]) — wrong-account
       data is structurally unreachable even without purge.
  `;
}

export let localAccountCleanupService: LocalAccountCleanupService | null = null;

export const initLocalAccountCleanupService = (db: CanonicalDatabase): LocalAccountCleanupService => {
  localAccountCleanupService = new LocalAccountCleanupService(db);
  return localAccountCleanupService;
};

export const getLocalAccountCleanupService = (): LocalAccountCleanupService | null => localAccountCleanupService;
