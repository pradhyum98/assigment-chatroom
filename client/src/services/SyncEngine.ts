import { canonicalDb } from './CanonicalDatabase';
import { CanonicalReconciler } from './CanonicalReconciler';
import { RecoveryCoordinator } from './RecoveryCoordinator';
import { OutboxService } from './OutboxService';
import { CryptoRevalidationService } from './CryptoRevalidationService';
import { BrowserPlatformLifecycleService } from './PlatformLifecycleService';
import { socketService } from './socket';
import { MigrationService } from './MigrationService';
import { CanonicalHistoryInstaller } from './CanonicalHistoryInstaller';
import { LocalAccountCleanupService, initLocalAccountCleanupService } from './LocalAccountCleanupService';
import { store } from '../store';
import {
  addOptimisticMutation,
  setOptimisticMutations,
  removeOptimisticMutation,
  setOptimisticMutations as clearOptimisticMutations,
} from '../features/chat/chatSlice';
import type { OptimisticMutation } from './optimisticTypes';
import api from './api';

import { DatabaseBackupService } from './DatabaseBackupService';
import { projectionSubscriptionService } from './ProjectionSubscriptionService';

class SyncEngine {
  public db = canonicalDb;
  public reconciler: CanonicalReconciler;
  public recoveryCoordinator: RecoveryCoordinator;
  public outboxService: OutboxService;
  public cryptoRevalidator: CryptoRevalidationService;
  public lifecycle: BrowserPlatformLifecycleService;
  public cleanupService: LocalAccountCleanupService;
  public backupService: DatabaseBackupService;
  private historyInstaller: CanonicalHistoryInstaller;

  /** Monotonically-increasing generation counter. Incremented on logout/account switch. */
  private generationRef: { current: number } = { current: 0 };

  constructor() {
    this.reconciler = new CanonicalReconciler(this.db);
    this.recoveryCoordinator = new RecoveryCoordinator(this.db, this.reconciler);
    this.cryptoRevalidator = new CryptoRevalidationService(this.db, (window as any).secretStore || {});
    this.outboxService = new OutboxService(this.db, this.cryptoRevalidator);
    this.lifecycle = new BrowserPlatformLifecycleService(this.recoveryCoordinator);
    this.historyInstaller = new CanonicalHistoryInstaller(this.db);
    this.cleanupService = initLocalAccountCleanupService(this.db);
    this.backupService = new DatabaseBackupService(this.db, this.generationRef);
  }

  async init(accountId: string) {
    console.log(`[SyncEngine] Initializing for account ${accountId}`);
    this.db.setAccountId(accountId);

    // 1. Run legacy data migrations
    const migrationService = new MigrationService(this.db);
    await migrationService.migrateLegacyData(accountId);

    // 1b. Check for a dangling restore_in_progress sentinel.
    //     If a previous restoreBackup() was interrupted after the purge step but
    //     before all records were written, the IDB is in an unknown partial state.
    //     Force a full BOOTSTRAPPING from the server so canonical state is rebuilt.
    try {
      const idb = await this.db.open();
      if (idb.objectStoreNames.contains('sync_meta')) {
        const sentinelTx = idb.transaction('sync_meta', 'readwrite');
        const sentinel: any = await new Promise((res) => {
          const req = sentinelTx.objectStore('sync_meta').get([accountId, 'restore_in_progress']);
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(null);
        });
        if (sentinel) {
          console.warn('[SyncEngine] restore_in_progress sentinel found — wiping stale IDB and forcing full server bootstrap.');
          // Clear the sentinel
          sentinelTx.objectStore('sync_meta').delete([accountId, 'restore_in_progress']);
          await new Promise<void>((res) => { sentinelTx.oncomplete = () => res(); sentinelTx.onerror = () => res(); });
          // Wipe all account stores so RecoveryCoordinator starts from scratch
          if (this.cleanupService) {
            await this.cleanupService.purgeAccount(accountId, 'ACCOUNT_SWITCH');
          }
        }
      }
    } catch (err) {
      console.warn('[SyncEngine] restore sentinel check failed (non-fatal):', err);
    }

    // 2. Rehydrate pending outbox mutations into Redux optimistic overlay
    await this._rehydrateOutboxOverlay(accountId);

    // 2b. Reset any PERMANENTLY_REJECTED messages back to PENDING.
    // These were wrongly rejected by CryptoRevalidationService when room_projections
    // was empty (IDB not yet bootstrapped). Now that the bug is fixed, retry them.
    await this._resetWronglyRejectedMutations(accountId);

    // 3. Hydrate Redux state from local Canonical Database immediately (offline-first)
    await projectionSubscriptionService.hydrateFromCanonical(this.db);

    // 4. Trigger initial bootstrap recovery (sync with server) and handle offline errors gracefully
    try {
      await this.recoveryCoordinator.triggerRecovery('app_startup');
    } catch (err) {
      console.warn('[SyncEngine] Initial bootstrap recovery failed (offline mode):', err);
    }

    // 4. Hook up socket — SyncEngine is the sole consumer of durable events
    const socket = socketService.connect();
    if (socket) {
      socket.on('room_event', (event: unknown) => {
        this.recoveryCoordinator.handleIncomingRoomEvent(event as any);
      });
      socket.on('user_event', (event: unknown) => {
        this.recoveryCoordinator.handleIncomingUserEvent(event as any);
      });
      socket.on('connect', () => {
        this.recoveryCoordinator.triggerRecovery('socket_connect');
        // Flush outbox on every reconnect so queued messages go out immediately.
        this.outboxService.flush();
      });
    }

    // 5. Flush outbox once on startup (after recovery) so any pending messages go out.
    this.outboxService.flush();
  }

  async logout(accountId: string): Promise<void> {
    console.log(`[SyncEngine] Logging out account ${accountId}`);
    // 1. Increment generation barrier — cancels stale in-flight async writes
    this.generationRef.current += 1;
    // 2. Cancel recovery and lifecycle
    this.recoveryCoordinator.cancelRecovery();
    this.lifecycle.destroy();
    // 3. Disconnect socket
    socketService.disconnect();
    // 4. Clear Redux optimistic state
    store.dispatch(clearOptimisticMutations([]));
    // 5. Purge all account-scoped IDB stores + SecretStore (ordering: SecretStore first)
    try {
      await this.cleanupService.purgeAccount(accountId, 'LOGOUT');
    } catch (err) {
      console.error('[SyncEngine] LocalAccountCleanupService.purgeAccount failed:', err);
      // Do not throw — DB (server-side) revocation remains authoritative
    }
  }

  // ── Mutation enqueue ────────────────────────────────────────────────────────

  async enqueueMutation(mutation: OptimisticMutation): Promise<void> {
    if (!this.outboxService) {
      console.error('[SyncEngine] Cannot enqueue mutation: not initialized');
      return;
    }
    // 1. Persist to IDB outbox FIRST (durable)
    await this.outboxService.enqueueMutation({
      mutationId: mutation.mutationId,
      clientMsgId: mutation.clientMsgId,
      roomId: mutation.roomId,
      actionType: mutation.actionType,
      payload: mutation.payload,
      createdAt: mutation.createdAt,
    });
    // 2. Add to Redux optimistic overlay
    store.dispatch(addOptimisticMutation(mutation));
  }

  /**
   * Called by CanonicalReconciler when a canonical event is committed.
   * Removes the matching optimistic overlay entry.
   */
  finalizeOptimisticMutation(clientMsgId: string | undefined, mutationId: string | undefined) {
    const key = clientMsgId ?? mutationId;
    if (key) {
      store.dispatch(removeOptimisticMutation(key));
    }
  }

  // ── Historical pagination ───────────────────────────────────────────────────

  /**
   * Fetches one page of messages older than `beforeDate` and installs them
   * into IDB via CanonicalHistoryInstaller (enforces all conflict-resolution invariants).
   * Returns whether there are more pages.
   */
  async fetchHistoricalMessages(roomId: string, beforeDate: string): Promise<boolean> {
    const gen = this.generationRef.current;
    try {
      const response = await api.get(`/messages/${roomId}?before=${beforeDate}`);
      const rawMessages: unknown[] = response?.data?.data?.messages ?? [];
      const hasMore: boolean = response?.data?.data?.pagination?.hasMore ?? false;

      await this.historyInstaller.installPage(roomId, rawMessages, this.generationRef, gen);
      return hasMore;
    } catch (e) {
      console.error('[SyncEngine] fetchHistoricalMessages error:', e);
      return false;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _rehydrateOutboxOverlay(accountId: string) {
    try {
      const items = await this.db.getAll<any>(
        'offline_queue_v3',
        IDBKeyRange.bound([accountId, ''], [accountId, '\uffff'])
      );
      const pending = items.filter(
        (i: any) => ['PENDING', 'RETRYABLE_FAILURE', 'SENDING'].includes(i.status)
      ) as OptimisticMutation[];
      if (pending.length > 0) {
        store.dispatch(setOptimisticMutations(pending));
      }
    } catch (e) {
      console.warn('[SyncEngine] Failed to rehydrate outbox overlay:', e);
    }
  }

  /**
   * Resets PERMANENTLY_REJECTED mutations back to PENDING so they are retried.
   * These were wrongly rejected when room_projections was not yet populated in IDB.
   */
  private async _resetWronglyRejectedMutations(accountId: string) {
    try {
      const idb = await this.db.open();
      const tx = idb.transaction('offline_queue_v3', 'readwrite');
      const store = tx.objectStore('offline_queue_v3');
      const range = IDBKeyRange.bound([accountId, ''], [accountId, '\uffff']);
      const req = store.getAll(range);
      req.onsuccess = () => {
        const items: any[] = req.result || [];
        items
          .filter((i) => i.status === 'PERMANENTLY_REJECTED' && i.actionType === 'SEND_MESSAGE')
          .forEach((item) => {
            item.status = 'PENDING';
            item.attemptCount = 0;
            item.nextAttemptAt = Date.now();
            store.put(item);
          });
      };
    } catch (e) {
      console.warn('[SyncEngine] Failed to reset rejected mutations:', e);
    }
  }
}

export const syncEngine = new SyncEngine();
