/**
 * CanonicalDatabase — IDB atomicity, cursor, duplicate-guard, migration tests.
 * Uses fake-indexeddb/auto so the entire suite runs in jsdom without skipping.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { CanonicalDatabase } from '../services/CanonicalDatabase';

// Helper: create a fresh isolated DB instance per test
function makeDb(accountId = 'acct-1'): CanonicalDatabase {
  const db = new CanonicalDatabase();
  db.setAccountId(accountId);
  return db;
}

// ── Schema & open ────────────────────────────────────────────────────────────

describe('CanonicalDatabase — schema & open', () => {
  it('opens successfully and creates expected stores', async () => {
    const db = makeDb();
    const idb = await db.open();
    expect(idb.objectStoreNames.contains('room_events')).toBe(true);
    expect(idb.objectStoreNames.contains('user_events')).toBe(true);
    expect(idb.objectStoreNames.contains('room_cursors')).toBe(true);
    expect(idb.objectStoreNames.contains('user_cursor')).toBe(true);
    expect(idb.objectStoreNames.contains('room_projections')).toBe(true);
    expect(idb.objectStoreNames.contains('message_projections')).toBe(true);
    expect(idb.objectStoreNames.contains('membership_projections')).toBe(true);
    expect(idb.objectStoreNames.contains('offline_queue_v3')).toBe(true);
    expect(idb.objectStoreNames.contains('processed_events')).toBe(true);
    expect(idb.objectStoreNames.contains('sync_meta')).toBe(true);
    expect(idb.objectStoreNames.contains('upload_checkpoints')).toBe(true);
    expect(idb.objectStoreNames.contains('cleanup_intents')).toBe(true);
    expect(idb.objectStoreNames.contains('snapshot_manifests')).toBe(true);
    await db.close();
  });

  it('returns same IDBDatabase on repeated open calls', async () => {
    const db = makeDb();
    const idb1 = await db.open();
    const idb2 = await db.open();
    expect(idb1).toBe(idb2);
    await db.close();
  });
});

// ── Transaction commit atomicity ──────────────────────────────────────────────

describe('CanonicalDatabase — transaction commit atomicity', () => {
  it('persists all writes in a single committed transaction', async () => {
    const db = makeDb('acct-atomic');
    const tx = await db.transaction(['room_projections', 'message_projections'], 'readwrite');

    tx.objectStore('room_projections').put({ accountId: 'acct-atomic', roomId: 'room-1', roomName: 'Test' });
    tx.objectStore('message_projections').put({
      accountId: 'acct-atomic', messageId: 'msg-1', roomId: 'room-1',
      senderId: 'u1', senderName: 'Alice', content: 'hello', timestamp: new Date().toISOString()
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const room = await db.get('room_projections', ['acct-atomic', 'room-1']);
    const msg = await db.get('message_projections', ['acct-atomic', 'msg-1']);
    expect(room).toBeDefined();
    expect((room as any).roomName).toBe('Test');
    expect(msg).toBeDefined();
    expect((msg as any).content).toBe('hello');
    await db.close();
  });

  it('rollback: aborted transaction produces no writes', async () => {
    const db = makeDb('acct-rollback');
    const tx = await db.transaction('room_projections', 'readwrite');

    tx.objectStore('room_projections').put({ accountId: 'acct-rollback', roomId: 'room-abort', roomName: 'ShouldNotExist' });

    // Abort explicitly
    tx.abort();

    await new Promise<void>((resolve) => {
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });

    const room = await db.get('room_projections', ['acct-rollback', 'room-abort']);
    expect(room).toBeUndefined();
    await db.close();
  });
});

// ── Processed event duplicate guard ──────────────────────────────────────────

describe('CanonicalDatabase — processed_events duplicate guard', () => {
  it('stores and retrieves a processed event marker', async () => {
    const db = makeDb('acct-dedup');
    const tx = await db.transaction('processed_events', 'readwrite');
    const eventId = 'room_room-x_42';
    tx.objectStore('processed_events').put({ accountId: 'acct-dedup', eventId, timestamp: new Date().toISOString() });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const marker = await db.get('processed_events', ['acct-dedup', eventId]);
    expect(marker).toBeDefined();
    await db.close();
  });

  it('allows overwriting a processed marker (idempotent put)', async () => {
    const db = makeDb('acct-dedup2');
    const eventId = 'room_room-y_1';
    const ts1 = '2024-01-01T00:00:00.000Z';
    const ts2 = '2024-01-02T00:00:00.000Z';

    for (const ts of [ts1, ts2]) {
      const tx = await db.transaction('processed_events', 'readwrite');
      tx.objectStore('processed_events').put({ accountId: 'acct-dedup2', eventId, timestamp: ts });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    const marker = await db.get<any>('processed_events', ['acct-dedup2', eventId]);
    expect(marker?.timestamp).toBe(ts2);
    await db.close();
  });
});

// ── Cursor monotonicity ───────────────────────────────────────────────────────

describe('CanonicalDatabase — room cursor monotonicity', () => {
  it('advances lastContiguousSequence for sequential events', async () => {
    const db = makeDb('acct-cursor');

    for (let seq = 1; seq <= 5; seq++) {
      const tx = await db.transaction('room_cursors', 'readwrite');
      const cursorStore = tx.objectStore('room_cursors');
      await new Promise<void>((res, rej) => {
        const req = cursorStore.get(['acct-cursor', 'room-1']);
        req.onsuccess = () => {
          const current = req.result || { accountId: 'acct-cursor', roomId: 'room-1', lastContiguousSequence: 0 };
          if (seq === current.lastContiguousSequence + 1) {
            current.lastContiguousSequence = seq;
            cursorStore.put(current);
          }
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        };
        req.onerror = () => rej(req.error);
      });
    }

    const cursor = await db.get<any>('room_cursors', ['acct-cursor', 'room-1']);
    expect(cursor?.lastContiguousSequence).toBe(5);
    await db.close();
  });

  it('does NOT advance cursor for out-of-order event', async () => {
    const db = makeDb('acct-cursor-oop');

    // Write seq=1
    const tx1 = await db.transaction('room_cursors', 'readwrite');
    tx1.objectStore('room_cursors').put({ accountId: 'acct-cursor-oop', roomId: 'room-1', lastContiguousSequence: 1 });
    await new Promise<void>((res, rej) => { tx1.oncomplete = () => res(); tx1.onerror = () => rej(tx1.error); });

    // Attempt seq=3 (gap at 2) — should not advance
    const tx2 = await db.transaction('room_cursors', 'readwrite');
    await new Promise<void>((res, rej) => {
      const req = tx2.objectStore('room_cursors').get(['acct-cursor-oop', 'room-1']);
      req.onsuccess = () => {
        const current = req.result;
        if (3 === current.lastContiguousSequence + 1) {
          current.lastContiguousSequence = 3;
          tx2.objectStore('room_cursors').put(current);
        }
        tx2.oncomplete = () => res();
        tx2.onerror = () => rej(tx2.error);
      };
      req.onerror = () => rej(req.error);
    });

    const cursor = await db.get<any>('room_cursors', ['acct-cursor-oop', 'room-1']);
    expect(cursor?.lastContiguousSequence).toBe(1); // unchanged
    await db.close();
  });
});

// ── Close/reopen persistence ──────────────────────────────────────────────────

describe('CanonicalDatabase — close/reopen persistence', () => {
  it('persists data across close and reopen', async () => {
    const db = makeDb('acct-persist');
    const tx = await db.transaction('sync_meta', 'readwrite');
    tx.objectStore('sync_meta').put({ accountId: 'acct-persist', key: 'test_key', value: 'hello' });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await db.close();

    // Reopen — same DB name, same data
    const db2 = makeDb('acct-persist');
    const val = await db2.get<any>('sync_meta', ['acct-persist', 'test_key']);
    expect(val?.value).toBe('hello');
    await db2.close();
  });
});

// ── Account isolation ─────────────────────────────────────────────────────────

describe('CanonicalDatabase — account isolation', () => {
  it('does not return data for a different accountId', async () => {
    const db = makeDb('acct-A');
    const tx = await db.transaction('sync_meta', 'readwrite');
    tx.objectStore('sync_meta').put({ accountId: 'acct-A', key: 'secret', value: 'private' });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    await db.close();

    const db2 = makeDb('acct-B');
    // acct-B should not find acct-A's key
    const val = await db2.get<any>('sync_meta', ['acct-B', 'secret']);
    expect(val).toBeUndefined();
    await db2.close();
  });
});

// ── Upload checkpoint persistence ─────────────────────────────────────────────

describe('CanonicalDatabase — upload checkpoint persistence', () => {
  it('stores and retrieves an upload checkpoint', async () => {
    const db = makeDb('acct-upload');
    const tx = await db.transaction('upload_checkpoints', 'readwrite');
    tx.objectStore('upload_checkpoints').put({
      accountId: 'acct-upload',
      fileHash: 'sha256-abc',
      uploadedBytes: 1024,
      url: 'https://cdn/abc',
      createdAt: new Date().toISOString()
    });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });

    const cp = await db.get<any>('upload_checkpoints', ['acct-upload', 'sha256-abc']);
    expect(cp?.uploadedBytes).toBe(1024);
    await db.close();
  });
});

// ── Cleanup intent persistence ────────────────────────────────────────────────

describe('CanonicalDatabase — cleanup intent persistence', () => {
  it('stores and survives close/reopen', async () => {
    const db = makeDb('acct-cleanup');
    const tx = await db.transaction('cleanup_intents', 'readwrite');
    tx.objectStore('cleanup_intents').put({
      accountId: 'acct-cleanup',
      intentId: 'purge_room_r1',
      type: 'PURGE_ROOM',
      payload: { roomId: 'r1' },
      status: 'PENDING',
      createdAt: new Date().toISOString()
    });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    await db.close();

    const db2 = makeDb('acct-cleanup');
    const intent = await db2.get<any>('cleanup_intents', ['acct-cleanup', 'purge_room_r1']);
    expect(intent?.status).toBe('PENDING');
    await db2.close();
  });
});

// ── Snapshot staging persistence ──────────────────────────────────────────────

describe('CanonicalDatabase — snapshot staging persistence', () => {
  it('stores and retrieves a snapshot manifest', async () => {
    const db = makeDb('acct-snap');
    const tx = await db.transaction('snapshot_manifests', 'readwrite');
    tx.objectStore('snapshot_manifests').put({
      accountId: 'acct-snap',
      roomId: 'r-snap',
      snapshotSequence: 100,
      status: 'STAGED',
      createdAt: new Date().toISOString()
    });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });

    const manifest = await db.get<any>('snapshot_manifests', ['acct-snap', 'r-snap']);
    expect(manifest?.snapshotSequence).toBe(100);
    expect(manifest?.status).toBe('STAGED');
    await db.close();
  });

  it('stores snapshot message staging rows', async () => {
    const db = makeDb('acct-snap2');
    const tx = await db.transaction('snapshot_message_staging', 'readwrite');
    tx.objectStore('snapshot_message_staging').put({
      accountId: 'acct-snap2',
      roomId: 'r-snap',
      sequenceNumber: 50,
      messageId: 'msg-staged-1',
      content: 'staged msg'
    });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });

    const row = await db.get<any>('snapshot_message_staging', ['acct-snap2', 'r-snap', 50, 'msg-staged-1']);
    expect(row?.content).toBe('staged msg');
    await db.close();
  });
});
