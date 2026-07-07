class IndexedDBService {
  private dbName = 'secure_chat_db';
  private version = 2;
  private db: IDBDatabase | null = null;

  open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;

        if (!db.objectStoreNames.contains('sync_meta')) {
          db.createObjectStore('sync_meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('offline_queue')) {
          db.createObjectStore('offline_queue', { keyPath: 'clientMsgId' });
        }
        if (!db.objectStoreNames.contains('upload_checkpoints')) {
          db.createObjectStore('upload_checkpoints', { keyPath: 'fileHash' });
        }

        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('offline_queue_v2')) {
            const v2 = db.createObjectStore('offline_queue_v2', { keyPath: 'queueId' });
            v2.createIndex('by_order', ['createdAt', 'sequenceNumber'], { unique: false });
          }
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        // Trigger non-destructive migration asynchronously
        this.migrateOfflineQueueV1ToV2().catch((err) => {
          console.error('[IndexedDB] Staged background migration error:', err);
        });
        resolve(this.db);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async get(storeName: string, key: string): Promise<any> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName: string, value: any): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName: string, key: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(storeName: string): Promise<any[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // staged queue migration methods
  async getActiveQueueStoreName(): Promise<string> {
    try {
      const state = await this.get('sync_meta', 'queue_migration_v2');
      if (state && state.value === 'complete') {
        return 'offline_queue_v2';
      }
    } catch (e) {
      console.warn('[IndexedDB] Migration state check failed, falling back to v1', e);
    }
    return 'offline_queue';
  }

  async migrateOfflineQueueV1ToV2(): Promise<void> {
    try {
      const state = await this.get('sync_meta', 'queue_migration_v2');
      if (state && (state.value === 'complete' || state.value === 'verifying')) {
        await this.verifyAndFinalizeMigration();
        return;
      }

      console.log('[IndexedDB] Staged queue migration (v1 -> v2) started...');
      const v1Items = await this.getAll('offline_queue');
      const now = Date.now();
      let seq = 0;

      for (const item of v1Items) {
        const v2Item = {
          ...item,
          queueId: item.clientMsgId || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2)),
          createdAt: now - (v1Items.length - seq) * 1000,
          sequenceNumber: seq++,
          status: 'pending',
          processingStartedAt: null,
          leaseExpiresAt: null,
          nextAttemptAt: now,
          lastError: null,
          retryCount: item.retryCount ?? 0,
          operationVersion: 1
        };
        await this.put('offline_queue_v2', v2Item);
      }

      await this.put('sync_meta', { key: 'queue_migration_v2', value: 'verifying' });
      await this.verifyAndFinalizeMigration();
    } catch (err) {
      console.error('[IndexedDB] Staged queue migration failed:', err);
      await this.put('sync_meta', { key: 'queue_migration_v2', value: 'failed' });
    }
  }

  async verifyAndFinalizeMigration(): Promise<void> {
    try {
      const v1Items = await this.getAll('offline_queue');
      const v2Items = await this.getAll('offline_queue_v2');

      const REQUIRED_FIELDS = [
        'queueId', 'createdAt', 'sequenceNumber', 'status',
        'processingStartedAt', 'leaseExpiresAt', 'nextAttemptAt', 'operationVersion'
      ];

      const allValid = v2Items.every(item =>
        REQUIRED_FIELDS.every(f => f in item)
      );

      if (v2Items.length >= v1Items.length && allValid) {
        await this.put('sync_meta', { key: 'queue_migration_v2', value: 'complete' });
        console.log('[IndexedDB] Queue migration verification passed. Switched to offline_queue_v2.');
      } else {
        console.error('[IndexedDB] Queue migration verification failed. Remaining on v1.');
        await this.put('sync_meta', { key: 'queue_migration_v2', value: 'failed' });
      }
    } catch (err) {
      console.error('[IndexedDB] Verification execution failed:', err);
      await this.put('sync_meta', { key: 'queue_migration_v2', value: 'failed' });
    }
  }
}

export const localDb = new IndexedDBService();
export default localDb;
