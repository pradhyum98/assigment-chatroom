export const DB_NAME = 'secure_chat_canonical';
export const DB_VERSION = 1;

export class CanonicalDatabase {
  private db: IDBDatabase | null = null;
  private currentAccountId: string | null = null;

  setAccountId(accountId: string) {
    this.currentAccountId = accountId;
  }

  getAccountId(): string {
    if (!this.currentAccountId) {
      throw new Error('CanonicalDatabase: accountId is not set. Cannot perform isolated operations.');
    }
    return this.currentAccountId;
  }

  open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexedDB is not defined'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;

        // Version 1 Schema Initialization
        if (oldVersion < 1) {
          // --- Canonical Events ---
          db.createObjectStore('room_events', { keyPath: ['accountId', 'roomId', 'sequenceNumber'] });
          db.createObjectStore('user_events', { keyPath: ['accountId', 'sequenceNumber'] });
          
          // --- Cursors ---
          db.createObjectStore('room_cursors', { keyPath: ['accountId', 'roomId'] });
          db.createObjectStore('user_cursor', { keyPath: 'accountId' });
          
          // --- Projections (Active) ---
          const rp = db.createObjectStore('room_projections', { keyPath: ['accountId', 'roomId'] });
          rp.createIndex('by_generation', ['accountId', 'generationId'], { unique: false });

          const mp = db.createObjectStore('message_projections', { keyPath: ['accountId', 'messageId'] });
          mp.createIndex('by_room_seq', ['accountId', 'roomId', 'sequenceNumber'], { unique: false });

          db.createObjectStore('membership_projections', { keyPath: ['accountId', 'roomId'] });
          
          // --- Offline Queue ---
          const oq = db.createObjectStore('offline_queue_v3', { keyPath: ['accountId', 'mutationId'] });
          oq.createIndex('by_room_order', ['accountId', 'roomId', 'order'], { unique: false });
          oq.createIndex('by_status', ['accountId', 'status'], { unique: false });

          // --- Processed Event Markers ---
          // eventId = streamType_streamId_sequenceNumber
          db.createObjectStore('processed_events', { keyPath: ['accountId', 'eventId'] });
          
          // --- Metadata & Checkpoints ---
          db.createObjectStore('sync_meta', { keyPath: ['accountId', 'key'] });
          db.createObjectStore('upload_checkpoints', { keyPath: ['accountId', 'fileHash'] });
          db.createObjectStore('cleanup_intents', { keyPath: ['accountId', 'intentId'] });

          // --- Snapshot Staging Stores ---
          db.createObjectStore('snapshot_manifests', { keyPath: ['accountId', 'roomId'] });
          db.createObjectStore('snapshot_room_staging', { keyPath: ['accountId', 'roomId', 'sequenceNumber'] });
          db.createObjectStore('snapshot_message_staging', { keyPath: ['accountId', 'roomId', 'sequenceNumber', 'messageId'] });
          db.createObjectStore('snapshot_membership_staging', { keyPath: ['accountId', 'roomId', 'sequenceNumber'] });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async transaction(storeNames: string | string[], mode: IDBTransactionMode = 'readonly'): Promise<IDBTransaction> {
    const db = await this.open();
    return db.transaction(storeNames, mode);
  }

  async get<T>(storeName: string, key: any): Promise<T | undefined> {
    const tx = await this.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll<T>(storeName: string, query?: IDBValidKey | IDBKeyRange): Promise<T[]> {
    const tx = await this.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.getAll(query);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

export const canonicalDb = new CanonicalDatabase();
