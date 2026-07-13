/**
 * Outbox and Optimistic Overlay Reconciliation — hostile tests.
 * Uses fake-indexeddb/auto and vitest.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanonicalDatabase } from '../services/CanonicalDatabase';
import { OutboxService } from '../services/OutboxService';
import { CryptoRevalidationService } from '../services/CryptoRevalidationService';
import { syncEngine } from '../services/SyncEngine';
import { store } from '../store';
import { socketService } from '../services/socket';
import {
  addOptimisticMutation,
  setOptimisticMutations,
  selectVisibleMessages
} from '../features/chat/chatSlice';
import type { OptimisticMutation } from '../services/optimisticTypes';

const ACCOUNT = 'acct-outbox';
const ROOM = 'room-outbox';

function makeDb(): CanonicalDatabase {
  const db = new CanonicalDatabase();
  db.setAccountId(ACCOUNT);
  return db;
}

describe('Outbox and Optimistic Overlay Reconciliation', () => {
  let db: CanonicalDatabase;
  let outboxService: OutboxService;
  let cryptoRevalidator: CryptoRevalidationService;

  beforeEach(async () => {
    db = makeDb();
    await db.open();
    cryptoRevalidator = new CryptoRevalidationService(db, { getRoomKey: () => 'dummy-key' });
    outboxService = new OutboxService(db, cryptoRevalidator);
    
    // Clean up store
    store.dispatch(setOptimisticMutations([]));
  });

  // ── 1. Enqueue persists Outbox first → add OptimisticOverlay ──

  it('enqueues mutation: persists to IndexedDB first, then adds optimistic overlay', async () => {
    const mutation: OptimisticMutation = {
      mutationId: 'mut-100',
      clientMsgId: 'client-100',
      accountId: ACCOUNT,
      roomId: ROOM,
      actionType: 'SEND_MESSAGE',
      createdAt: new Date().toISOString(),
      status: 'PENDING',
      payload: {
        senderId: 'u1',
        senderName: 'Alice',
        content: 'hello outbox',
        timestamp: new Date().toISOString(),
        type: 'text'
      }
    };

    // Spy on store dispatch
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    // Seed SyncEngine db & outboxService references for this test
    syncEngine.db = db;
    (syncEngine as any).outboxService = outboxService;

    await syncEngine.enqueueMutation(mutation);

    // Verify persisted in DB
    const dbItem = await db.get<any>('offline_queue_v3', [ACCOUNT, 'mut-100']);
    expect(dbItem).toBeDefined();
    expect(dbItem.status).toBe('PENDING');

    // Verify dispatched to store
    expect(dispatchSpy).toHaveBeenCalled();
    const visible = selectVisibleMessages(store.getState(), ROOM, ACCOUNT);
    expect(visible).toHaveLength(1);
    expect(visible[0].content).toBe('hello outbox');

    dispatchSpy.mockRestore();
  });

  // ── 2. ACK updates status while keeping optimistic overlay ──

  it('processes item to ACK: updates Outbox item to ACKNOWLEDGED in DB but retains overlay', async () => {
    const item = {
      accountId: ACCOUNT,
      mutationId: 'mut-200',
      clientMsgId: 'client-200',
      roomId: ROOM,
      actionType: 'SEND_MESSAGE',
      payload: { senderId: 'u1', senderName: 'Alice', content: 'ack test', timestamp: new Date().toISOString(), type: 'text' as const },
      createdAt: new Date().toISOString(),
      order: 1,
      attemptCount: 0,
      nextAttemptAt: Date.now(),
      status: 'PENDING' as const
    };

    // Pre-populate DB and store overlay
    const tx = await db.transaction('offline_queue_v3', 'readwrite');
    await tx.objectStore('offline_queue_v3').put(item);
    await new Promise<void>((resolve) => tx.oncomplete = () => resolve());

    store.dispatch(addOptimisticMutation({
      ...item,
      status: 'PENDING'
    } as any));

    // Stub validation and re-encryption to succeed
    vi.spyOn(cryptoRevalidator, 'validate').mockResolvedValue({ isValid: true, needsReencryption: false });

    // Stub socket sendMessage to immediately invoke handleAck with ok: true
    const sendSpy = vi.spyOn(socketService, 'sendMessage').mockImplementation((data, callback) => {
      callback?.({ ok: true, clientMsgId: data.clientMsgId });
    });

    // Process item
    await (outboxService as any).processItem(item);

    // DB state must be ACKNOWLEDGED
    const dbItem = await db.get<any>('offline_queue_v3', [ACCOUNT, 'mut-200']);
    expect(dbItem.status).toBe('ACKNOWLEDGED');

    // Overlay is retained (to let canonical event replace it smoothly)
    const visible = selectVisibleMessages(store.getState(), ROOM, ACCOUNT);
    expect(visible).toHaveLength(1);
    expect(visible[0].content).toBe('ack test');

    sendSpy.mockRestore();
  });

  // ── 3. Access revocation: quarantines outbox item and removes overlay ──

  it('handles room access revocation: quarantines outbox items and removes optimistic overlay', async () => {
    const item = {
      accountId: ACCOUNT,
      mutationId: 'mut-300',
      clientMsgId: 'client-300',
      roomId: ROOM,
      actionType: 'SEND_MESSAGE',
      payload: { senderId: 'u1', senderName: 'Alice', content: 'revocation test', timestamp: new Date().toISOString(), type: 'text' as const },
      createdAt: new Date().toISOString(),
      order: 2,
      attemptCount: 0,
      nextAttemptAt: Date.now(),
      status: 'PENDING' as const
    };

    // Pre-populate
    const tx = await db.transaction('offline_queue_v3', 'readwrite');
    await tx.objectStore('offline_queue_v3').put(item);
    await new Promise<void>((resolve) => tx.oncomplete = () => resolve());

    store.dispatch(addOptimisticMutation({
      ...item,
      status: 'PENDING'
    } as any));

    // Force validation failure due to access revocation (isValid: false, needsReencryption: false)
    vi.spyOn(cryptoRevalidator, 'validate').mockResolvedValue({ isValid: false, needsReencryption: false });

    await (outboxService as any).processItem(item);

    // DB state must be PERMANENTLY_REJECTED or similar
    const dbItem = await db.get<any>('offline_queue_v3', [ACCOUNT, 'mut-300']);
    expect(dbItem.status).toBe('PERMANENTLY_REJECTED');

    // As per UX policy, permanently rejected mutations are removed or marked failed.
    // In our selectVisibleMessages implementation, PERMANENTLY_REJECTED is filtered out.
    const visible = selectVisibleMessages(store.getState(), ROOM, ACCOUNT);
    expect(visible).toHaveLength(0);
  });
});
