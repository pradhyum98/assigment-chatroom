import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import localDb from '../services/indexedDb';

describe('IndexedDB Staged Migration (v1 -> v2)', () => {
  beforeEach(async () => {
    // Reset database state completely before each test
    const db = await localDb.open();
    db.close();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('secure_chat_db');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    // Force reopen clean
    (localDb as any).db = null;
  });

  afterEach(async () => {
    const db = await localDb.open();
    db.close();
  });

  it('performs staged migration and sets migration state to complete on verification success', async () => {
    // 1. Force open database as version 1 manually to populate legacy data
    await new Promise<void>((resolve, reject) => {
      const openReq = indexedDB.open('secure_chat_db', 1);
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        db.createObjectStore('offline_queue', { keyPath: 'clientMsgId' });
        db.createObjectStore('sync_meta', { keyPath: 'key' });
      };
      openReq.onsuccess = () => {
        const db = openReq.result;
        const tx = db.transaction(['offline_queue'], 'readwrite');
        const store = tx.objectStore('offline_queue');
        
        store.put({ clientMsgId: 'msg-id-1', roomId: 'room-1', content: 'Legacy Message 1', actionType: 'send' });
        store.put({ clientMsgId: 'msg-id-2', roomId: 'room-1', content: 'Legacy Message 2', actionType: 'send', retryCount: 2 });
        
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      openReq.onerror = () => reject(openReq.error);
    });

    // 2. Open via our service, triggering version 2 upgrade and background migration runner
    await localDb.open();

    // Give background async migration a short tick to complete
    await new Promise(resolve => setTimeout(resolve, 150));

    // 3. Verify active queue store name transitioned to v2
    const activeStore = await localDb.getActiveQueueStoreName();
    expect(activeStore).toBe('offline_queue_v2');

    // 4. Verify items in v2 contain required properties
    const v2Items = await localDb.getAll('offline_queue_v2');
    expect(v2Items.length).toBe(2);

    const first = v2Items.find(i => i.clientMsgId === 'msg-id-1');
    expect(first).toBeDefined();
    expect(first.queueId).toBe('msg-id-1');
    expect(first.status).toBe('pending');
    expect(first.operationVersion).toBe(1);
    expect(first.createdAt).toBeDefined();
    expect(first.sequenceNumber).toBeDefined();

    const second = v2Items.find(i => i.clientMsgId === 'msg-id-2');
    expect(second.retryCount).toBe(2);

    // 5. Verify v1 store still has records (staged migration constraint)
    const v1Items = await localDb.getAll('offline_queue');
    expect(v1Items.length).toBe(2);
  });

  it('resumes migration if left in verifying state (interruption recovery)', async () => {
    // 1. Pre-setup db directly in v2 and record state as verifying
    await new Promise<void>((resolve, reject) => {
      const openReq = indexedDB.open('secure_chat_db', 2);
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        db.createObjectStore('sync_meta', { keyPath: 'key' });
        db.createObjectStore('offline_queue', { keyPath: 'clientMsgId' });
        const v2 = db.createObjectStore('offline_queue_v2', { keyPath: 'queueId' });
        v2.createIndex('by_order', ['createdAt', 'sequenceNumber'], { unique: false });
      };
      openReq.onsuccess = () => {
        const db = openReq.result;
        const tx = db.transaction(['sync_meta', 'offline_queue', 'offline_queue_v2'], 'readwrite');
        tx.objectStore('sync_meta').put({ key: 'queue_migration_v2', value: 'verifying' });
        tx.objectStore('offline_queue').put({ clientMsgId: 'msg-id-1', roomId: 'r-1', content: 'IntMsg', actionType: 'send' });
        
        // Put migrated item in v2
        tx.objectStore('offline_queue_v2').put({
          queueId: 'msg-id-1',
          clientMsgId: 'msg-id-1',
          roomId: 'r-1',
          content: 'IntMsg',
          actionType: 'send',
          createdAt: Date.now(),
          sequenceNumber: 0,
          status: 'pending',
          processingStartedAt: null,
          leaseExpiresAt: null,
          nextAttemptAt: Date.now(),
          lastError: null,
          retryCount: 0,
          operationVersion: 1
        });

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      openReq.onerror = () => reject(openReq.error);
    });

    // 2. Open via service which triggers verification resume
    await localDb.open();
    await new Promise(resolve => setTimeout(resolve, 150));

    // Verify migration completed on restart
    const state = await localDb.get('sync_meta', 'queue_migration_v2');
    expect(state.value).toBe('complete');
    expect(await localDb.getActiveQueueStoreName()).toBe('offline_queue_v2');
  });

  it('falls back to offline_queue v1 if verification fails', async () => {
    let testDb: IDBDatabase | null = null;
    await new Promise<void>((resolve, reject) => {
      const openReq = indexedDB.open('secure_chat_db', 2);
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        db.createObjectStore('sync_meta', { keyPath: 'key' });
        db.createObjectStore('offline_queue', { keyPath: 'clientMsgId' });
        const v2 = db.createObjectStore('offline_queue_v2', { keyPath: 'queueId' });
        v2.createIndex('by_order', ['createdAt', 'sequenceNumber'], { unique: false });
      };
      openReq.onsuccess = () => {
        testDb = openReq.result;
        const tx = testDb.transaction(['sync_meta', 'offline_queue'], 'readwrite');
        tx.objectStore('sync_meta').put({ key: 'queue_migration_v2', value: 'verifying' });
        tx.objectStore('offline_queue').put({ clientMsgId: 'msg-1', roomId: 'r-1', content: 'Msg' });
        tx.oncomplete = () => {
          resolve();
        };
      };
      openReq.onerror = () => reject(openReq.error);
    });

    // Bypass background auto-migration by seeding the db reference directly
    (localDb as any).db = testDb;

    // Explicitly call verify which will check:
    // v2Items.length (0) < v1Items.length (1) -> verification fails
    await localDb.verifyAndFinalizeMigration();

    // Active store name must remain offline_queue (v1) due to verification failure
    const activeStore = await localDb.getActiveQueueStoreName();
    expect(activeStore).toBe('offline_queue');

    const state = await localDb.get('sync_meta', 'queue_migration_v2');
    expect(state.value).toBe('failed');
  });

  it('atomically enqueues message and sequence number (enqueueWithSequence)', async () => {
    await localDb.open();
    // Simulate v2 migration complete
    const db = (localDb as any).db;
    const tx = db.transaction(['sync_meta'], 'readwrite');
    tx.objectStore('sync_meta').put({ key: 'queue_migration_v2', value: 'complete' });
    await new Promise(resolve => tx.oncomplete = resolve);

    const msgItem = {
      queueId: 'q-atom-1',
      clientMsgId: 'msg-atom-1',
      roomId: 'room-1',
      content: 'Hello',
      actionType: 'send' as const,
      createdAt: Date.now(),
      status: 'pending' as const,
      processingStartedAt: null,
      leaseExpiresAt: null,
      nextAttemptAt: Date.now(),
      lastError: null,
      retryCount: 0,
      operationVersion: 2 as const,
      sequenceNumber: -1 // will be overwritten
    };

    await localDb.enqueueWithSequence('offline_queue_v2', msgItem);
    // const seqResult: any = msgItem; // mock since it mutates in place or similar
    // The test asserts it was returned, but enqueueWithSequence returns void. Let's just read it back.

    const storedMsg = await localDb.get('offline_queue_v2', 'q-atom-1');
    expect(storedMsg.sequenceNumber).toBe(1);

    const seqMeta = await localDb.get('sync_meta', 'queue_seq');
    expect(seqMeta.value).toBe(1);

    // Try a second message to verify sequence increments
    const msgItem2 = { ...msgItem, queueId: 'q-atom-2', clientMsgId: 'msg-atom-2' };
    await localDb.enqueueWithSequence('offline_queue_v2', msgItem2);
    // const seqResult2: any = msgItem2;

    const storedMsg2 = await localDb.get('offline_queue_v2', 'q-atom-2');
    expect(storedMsg2.sequenceNumber).toBe(2);
  });
});

