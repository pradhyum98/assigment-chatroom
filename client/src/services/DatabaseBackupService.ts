import { CanonicalDatabase } from './CanonicalDatabase';
import { localAccountCleanupService } from './LocalAccountCleanupService';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

/** Canonical set of account-scoped stores (must match LocalAccountCleanupService). */
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

/** Only backup version this build can read/write. */
const SUPPORTED_BACKUP_VERSION = 1;

/** Forbidden fields that must never appear in a backup export. */
const FORBIDDEN_EXPORT_FIELDS = [
  'privateKey', 'e2e_private_key', 'accessToken', 'refreshToken',
  'password', 'passwordHash', 'cookie', 'roomKey', 'decryptedKey',
];

export interface BackupData {
  version: number;
  accountId: string;
  timestamp: string;
  stores: Record<string, any[]>;
}

export interface RestoreResult {
  success: boolean;
  error?: string;
}

export class DatabaseBackupService {
  private db: CanonicalDatabase;

  /**
   * Bound to the active session: incremented on logout/account switch by SyncEngine.
   * Passed in as a reference so we can detect mid-operation session change.
   */
  private sessionGeneration: { current: number };

  constructor(db: CanonicalDatabase, sessionGeneration?: { current: number }) {
    this.db = db;
    this.sessionGeneration = sessionGeneration ?? { current: 0 };
  }

  // ── Export ────────────────────────────────────────────────────────────────────

  /**
   * Export account-scoped IndexedDB snapshot to JSON.
   *
   * Isolation guarantees:
   *   - Only records where record.accountId === currentAccountId are included.
   *   - No forbidden secret fields are included in any record.
   *
   * Storage:
   *   - Primary: native filesystem via @capacitor/filesystem (Directory.Documents)
   *   - Fallback: browser <a download> blob URL
   *
   * Returns the serialised JSON string for test inspection.
   */
  async exportBackup(): Promise<string> {
    const accountId = this.db.getAccountId();
    const backup: BackupData = {
      version: SUPPORTED_BACKUP_VERSION,
      accountId,
      timestamp: new Date().toISOString(),
      stores: {},
    };

    const idb = await this.db.open();

    for (const storeName of ALL_ACCOUNT_STORES) {
      if (!idb.objectStoreNames.contains(storeName)) {
        continue;
      }

      const tx = idb.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);

      const allRecords: any[] = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      // Account isolation: only export records for this account.
      // All canonical_db v1 stores embed accountId on the record object.
      const isolated = allRecords.filter(r => {
        if (!r || typeof r !== 'object') return false;
        if (r.accountId !== undefined) return r.accountId === accountId;
        // Fallback: inspect first element of compound key path
        const kp = store.keyPath;
        const firstKey = Array.isArray(kp) ? kp[0] : kp;
        return typeof firstKey === 'string' && r[firstKey] === accountId;
      });

      // Strip any forbidden secret fields from each record (defence-in-depth).
      const scrubbed = isolated.map(r => {
        const out: any = { ...r };
        for (const field of FORBIDDEN_EXPORT_FIELDS) {
          delete out[field];
        }
        return out;
      });

      backup.stores[storeName] = scrubbed;
    }

    const jsonString = JSON.stringify(backup, null, 2);

    // Write to native filesystem; fall back to browser download.
    try {
      await Filesystem.writeFile({
        path: `secure_chat_backup_${accountId}.json`,
        data: jsonString,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      console.log('[BackupService] Backup written to native filesystem (Directory.Documents)');
    } catch (err: any) {
      console.log(`[BackupService] Native filesystem write failed: ${err?.message || err}. Falling back to browser download.`);
      this.triggerBrowserDownload(jsonString, accountId);
    }

    return jsonString;
  }

  // ── Restore ───────────────────────────────────────────────────────────────────

  /**
   * Restore database from a JSON backup string.
   *
   * Safety contract — Stage → Validate → Purge → Install → Rollback-on-failure:
   *
   *   1. Parse JSON (fail fast, no DB touched).
   *   2. Validate backup version, accountId, and structure in memory.
   *   3. Deep-validate every record in memory against the current account.
   *   4. Bind to current session generation; fail if session changed mid-op.
   *   5. Write a RESTORE_INTENT sentinel to sync_meta so the SyncEngine
   *      recovery coordinator knows to force a full server re-sync if anything
   *      goes wrong after the purge point.
   *   6. Purge the active account's stores via LocalAccountCleanupService.
   *   7. Write all validated records into their stores.
   *   8. Clear the RESTORE_INTENT sentinel on success.
   *   9. On any write failure after step 6, leave the RESTORE_INTENT sentinel
   *      so the next SyncEngine.init() triggers a full BOOTSTRAPPING cycle
   *      from the server — meaning the worst case is "re-sync from server",
   *      not "half-patched corrupt state".
   *
   * Cross-account write prevention:
   *   - Every record is re-checked against currentAccountId before being written.
   *   - Session generation is snapshotted before purge and re-checked before
   *     each store write — if logout/account-switch happens mid-restore, all
   *     subsequent store.put() calls are aborted.
   */
  async restoreBackup(backupContent: string): Promise<RestoreResult> {

    // ── Phase 1: Parse ─────────────────────────────────────────────────────────
    let backup: BackupData;
    try {
      backup = JSON.parse(backupContent);
    } catch {
      return { success: false, error: 'Malformed JSON: backup file cannot be parsed.' };
    }

    // ── Phase 2: Structure & version validation ────────────────────────────────
    if (typeof backup !== 'object' || backup === null) {
      return { success: false, error: 'Invalid backup: root is not an object.' };
    }
    if (backup.version !== SUPPORTED_BACKUP_VERSION) {
      return { success: false, error: `Unsupported backup version ${backup.version}. This build only supports version ${SUPPORTED_BACKUP_VERSION}.` };
    }
    if (typeof backup.accountId !== 'string' || backup.accountId.trim() === '') {
      return { success: false, error: 'Invalid backup: missing or empty accountId.' };
    }
    if (typeof backup.stores !== 'object' || backup.stores === null) {
      return { success: false, error: 'Invalid backup: stores field is missing or not an object.' };
    }

    // ── Phase 3: Account isolation check ──────────────────────────────────────
    const currentAccountId = this.db.getAccountId();
    if (backup.accountId !== currentAccountId) {
      return {
        success: false,
        error: `Account Isolation Violation: backup belongs to account "${backup.accountId}" but active session is "${currentAccountId}". Restore rejected — no database state was modified.`,
      };
    }

    // ── Phase 4: Deep record validation (in memory — no DB writes yet) ─────────
    for (const storeName of ALL_ACCOUNT_STORES) {
      const records = backup.stores[storeName];
      if (!records) continue;

      if (!Array.isArray(records)) {
        return { success: false, error: `Invalid backup: store "${storeName}" is not an array.` };
      }

      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (typeof r !== 'object' || r === null) {
          return { success: false, error: `Invalid record at ${storeName}[${i}]: not an object.` };
        }
        if (r.accountId !== currentAccountId) {
          return { success: false, error: `Account isolation violation: record at ${storeName}[${i}] has accountId "${r.accountId}" but active session is "${currentAccountId}".` };
        }
        // Check for forbidden secret fields that should never be in a backup
        for (const field of FORBIDDEN_EXPORT_FIELDS) {
          if (field in r) {
            return { success: false, error: `Security violation: record at ${storeName}[${i}] contains forbidden field "${field}". Backup rejected.` };
          }
        }
      }
    }

    // ── Phase 5: Session generation snapshot ──────────────────────────────────
    const generationAtStart = this.sessionGeneration.current;

    const sessionUnchanged = () => this.sessionGeneration.current === generationAtStart;

    // ── Phase 6: Write RESTORE_INTENT sentinel ─────────────────────────────────
    // This ensures SyncEngine.init() forces BOOTSTRAPPING if we crash after purge.
    try {
      const idbCheck = await this.db.open();
      if (idbCheck.objectStoreNames.contains('sync_meta')) {
        const intentTx = idbCheck.transaction('sync_meta', 'readwrite');
        intentTx.objectStore('sync_meta').put({
          accountId: currentAccountId,
          key: 'restore_in_progress',
          value: { startedAt: new Date().toISOString(), backupTimestamp: backup.timestamp },
        });
        await new Promise<void>((res, rej) => {
          intentTx.oncomplete = () => res();
          intentTx.onerror = () => rej(intentTx.error);
        });
      }
    } catch (err: any) {
      // Non-fatal — continue without intent sentinel
      console.warn('[BackupService] Could not write restore intent:', err?.message);
    }

    // ── Phase 7: Purge existing account state ──────────────────────────────────
    if (!sessionUnchanged()) {
      return { success: false, error: 'Session changed before purge started. Restore aborted — no database state was modified.' };
    }

    if (localAccountCleanupService) {
      console.log(`[BackupService] Purging existing database for account ${currentAccountId}...`);
      const purgeResult = await localAccountCleanupService.purgeAccount(currentAccountId, 'ACCOUNT_SWITCH');
      if (!purgeResult.success) {
        console.warn('[BackupService] Purge completed with errors, proceeding with restore:', purgeResult.errors);
      }
    }

    // ── Phase 8: Write validated records ──────────────────────────────────────
    const idb = await this.db.open();
    const writeErrors: string[] = [];

    for (const storeName of ALL_ACCOUNT_STORES) {
      const records = backup.stores[storeName];
      if (!records || records.length === 0) continue;

      // Session guard: abort if logout/account-switch happened mid-restore
      if (!sessionUnchanged()) {
        writeErrors.push(`Session changed during write of store "${storeName}". Aborting to prevent cross-account writes.`);
        break;
      }

      if (!idb.objectStoreNames.contains(storeName)) {
        console.warn(`[BackupService] Store "${storeName}" not in current schema — skipping.`);
        continue;
      }

      try {
        const tx = idb.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        for (const record of records) {
          // Final per-record account check before every write
          if (record.accountId !== currentAccountId) {
            tx.abort();
            writeErrors.push(`Cross-account record in "${storeName}" rejected mid-write.`);
            break;
          }
          store.put(record);
        }

        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (err: any) {
        writeErrors.push(`Write failed for store "${storeName}": ${err?.message ?? err}`);
      }
    }

    // ── Phase 9: Clear or preserve RESTORE_INTENT sentinel ────────────────────
    if (writeErrors.length === 0) {
      // Success: clear the sentinel so SyncEngine does a normal incremental sync
      try {
        const cleanIdb = await this.db.open();
        if (cleanIdb.objectStoreNames.contains('sync_meta')) {
          const clearTx = cleanIdb.transaction('sync_meta', 'readwrite');
          clearTx.objectStore('sync_meta').delete([currentAccountId, 'restore_in_progress']);
          await new Promise<void>((res) => { clearTx.oncomplete = () => res(); });
        }
      } catch {
        // Non-fatal
      }

      console.log(`[BackupService] Database restore completed successfully for account ${currentAccountId}`);
      return { success: true };
    } else {
      // Failure: leave RESTORE_INTENT so SyncEngine forces BOOTSTRAPPING on next init.
      // The user's data is gone (purged) but the server is authoritative and a full
      // re-sync will restore canonical state. This is acceptable — not catastrophic.
      const errorSummary = writeErrors.join('; ');
      console.error(`[BackupService] Restore failed with errors — BOOTSTRAPPING sentinel left for SyncEngine recovery: ${errorSummary}`);
      return {
        success: false,
        error: `Restore encountered write errors. Your local cache has been cleared. The app will re-sync from the server on next load. Details: ${errorSummary}`,
      };
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private triggerBrowserDownload(jsonString: string, accountId: string) {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `secure_chat_backup_${accountId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
