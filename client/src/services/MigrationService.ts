import { CanonicalDatabase } from './CanonicalDatabase';
import legacyDb from './indexedDb';

export class MigrationService {
  private canonicalDb: CanonicalDatabase;
  
  constructor(canonicalDb: CanonicalDatabase) {
    this.canonicalDb = canonicalDb;
  }

  async migrateLegacyData(accountId: string) {
    try {
      const legacy = await legacyDb.open();
      // Wait for legacy staged migration to finish if any
      const meta = await legacyDb.get('sync_meta', 'queue_migration_state');
      if (meta && meta.value === 'verifying') {
        // Fallback or finish verification? We'll just read whatever is the active queue.
      }
      
      const activeQueueName = await legacyDb.getActiveQueueStoreName();
      
      // Read all offline queue items
      const tx = legacy.transaction(activeQueueName, 'readonly');
      const store = tx.objectStore(activeQueueName);
      
      const allItems: any[] = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      if (allItems.length === 0) return;

      const cTx = await this.canonicalDb.transaction('offline_queue_v3', 'readwrite');
      const v3Store = cTx.objectStore('offline_queue_v3');
      
      let order = Date.now();
      
      for (const item of allItems) {
        // Quarantine all legacy offline queue items by default because we cannot guarantee 
        // they have correct sequences or aren't duplicates, plus we are switching paradigms.
        // We preserve them so they are not lost, but they must be re-validated.
        v3Store.put({
          accountId,
          mutationId: item.clientMsgId || item.queueId || crypto.randomUUID(),
          roomId: item.roomId || 'unknown',
          type: item.type || 'LEGACY_MUTATION',
          payload: item,
          status: 'QUARANTINED',
          createdAt: new Date().toISOString(),
          attemptCount: 0,
          nextAttemptAt: Date.now(),
          order: order++
        });
      }

      // We should also migrate upload checkpoints if we had any
      const chunkTx = legacy.transaction('upload_chunks', 'readonly');
      const chunkStore = chunkTx.objectStore('upload_chunks');
      const chunks = await new Promise<any[]>((resolve) => {
        const req = chunkStore.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve([]);
      });

      if (chunks.length > 0) {
        const metaTx = await this.canonicalDb.transaction('sync_meta', 'readwrite');
        const cMetaStore = metaTx.objectStore('sync_meta');
        for (const chunk of chunks) {
          cMetaStore.put({
            accountId,
            key: `legacy_upload_${chunk.uploadId}`,
            value: chunk
          });
        }
      }

      // Mark legacy migrated
      const mTx = await this.canonicalDb.transaction('sync_meta', 'readwrite');
      mTx.objectStore('sync_meta').put({ accountId, key: 'legacy_migrated', value: true });
      
      // Optionally clear legacy to avoid double migration
      const clearTx = legacy.transaction(activeQueueName, 'readwrite');
      clearTx.objectStore(activeQueueName).clear();

    } catch (e) {
      console.error('[MigrationService] Failed to migrate legacy data', e);
    }
  }
}
