/**
 * Projection Subscription Failure Recovery — hostile tests.
 * Uses fake-indexeddb/auto and vitest.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanonicalDatabase } from '../services/CanonicalDatabase';
import { projectionSubscriptionService } from '../services/ProjectionSubscriptionService';
import { store } from '../store';
import { clearMessages, setMessages } from '../features/chat/chatSlice';
import { setRooms } from '../features/rooms/roomsSlice';

const ACCOUNT_A = 'acct-A';
const ACCOUNT_B = 'acct-B';

function makeDb(accountId: string): CanonicalDatabase {
  const db = new CanonicalDatabase();
  db.setAccountId(accountId);
  return db;
}

describe('Projection Subscription Failure Recovery', () => {
  let dbA: CanonicalDatabase;
  let dbB: CanonicalDatabase;

  beforeEach(async () => {
    dbA = makeDb(ACCOUNT_A);
    dbB = makeDb(ACCOUNT_B);
    await dbA.open();
    await dbB.open();

    // Reset store
    store.dispatch(clearMessages());
    store.dispatch(setRooms([]));
  });

  // ── 1. hydrateFromCanonical seeds Redux ──

  it('hydrates rooms and messages from IndexedDB for the current account', async () => {
    // Seed A's data
    const tx = await dbA.transaction(['room_projections', 'message_projections'], 'readwrite');
    tx.objectStore('room_projections').put({ accountId: ACCOUNT_A, roomId: 'room-1', roomName: 'Room A' });
    tx.objectStore('message_projections').put({
      accountId: ACCOUNT_A,
      messageId: 'msg-1',
      roomId: 'room-1',
      senderId: 'u1',
      senderName: 'Alice',
      content: 'hello A',
      timestamp: new Date().toISOString()
    });
    await new Promise<void>((res) => tx.oncomplete = () => res());

    // Hydrate
    await projectionSubscriptionService.hydrateFromCanonical(dbA);

    // Verify Redux state
    const state = store.getState();
    expect(state.rooms.rooms).toHaveLength(1);
    expect(state.rooms.rooms[0].roomName).toBe('Room A');
    expect(state.chat.messages).toHaveLength(1);
    expect(state.chat.messages[0].content).toBe('hello A');
  });

  // ── 2. Idempotency & De-duplication ──

  it('proves repeated hydration is idempotent and does not duplicate messages', async () => {
    // Seed A's data
    const tx = await dbA.transaction(['room_projections', 'message_projections'], 'readwrite');
    tx.objectStore('room_projections').put({ accountId: ACCOUNT_A, roomId: 'room-1', roomName: 'Room A' });
    tx.objectStore('message_projections').put({
      accountId: ACCOUNT_A,
      messageId: 'msg-1',
      roomId: 'room-1',
      senderId: 'u1',
      senderName: 'Alice',
      content: 'hello A',
      timestamp: new Date().toISOString()
    });
    await new Promise<void>((res) => tx.oncomplete = () => res());

    // Hydrate twice
    await projectionSubscriptionService.hydrateFromCanonical(dbA);
    await projectionSubscriptionService.hydrateFromCanonical(dbA);

    const state = store.getState();
    expect(state.rooms.rooms).toHaveLength(1);
    expect(state.chat.messages).toHaveLength(1); // Not duplicated
  });

  // ── 3. Account switching isolation ──

  it('prevents account switching from hydrating data from another account', async () => {
    // Seed A's data
    const txA = await dbA.transaction(['room_projections', 'message_projections'], 'readwrite');
    txA.objectStore('room_projections').put({ accountId: ACCOUNT_A, roomId: 'room-A', roomName: 'Room A' });
    txA.objectStore('message_projections').put({
      accountId: ACCOUNT_A,
      messageId: 'msg-A',
      roomId: 'room-A',
      senderId: 'u1',
      senderName: 'Alice',
      content: 'hello A',
      timestamp: new Date().toISOString()
    });
    await new Promise<void>((res) => txA.oncomplete = () => res());

    // Seed B's data
    const txB = await dbB.transaction(['room_projections', 'message_projections'], 'readwrite');
    txB.objectStore('room_projections').put({ accountId: ACCOUNT_B, roomId: 'room-B', roomName: 'Room B' });
    txB.objectStore('message_projections').put({
      accountId: ACCOUNT_B,
      messageId: 'msg-B',
      roomId: 'room-B',
      senderId: 'u2',
      senderName: 'Bob',
      content: 'hello B',
      timestamp: new Date().toISOString()
    });
    await new Promise<void>((res) => txB.oncomplete = () => res());

    // Hydrate from dbB (Account B)
    await projectionSubscriptionService.hydrateFromCanonical(dbB);

    const state = store.getState();
    expect(state.rooms.rooms).toHaveLength(1);
    expect(state.rooms.rooms[0].roomId).toBe('room-B');
    expect(state.rooms.rooms[0].roomName).toBe('Room B');
    expect(state.chat.messages).toHaveLength(1);
    expect(state.chat.messages[0].messageId).toBe('msg-B');
  });

  // ── 4. Failed Redux notification does not rollback committed canonical state ──

  it('does not rollback IDB state even if Redux notification throws', async () => {
    // Mock store dispatch to throw error when setting messages
    const originalDispatch = store.dispatch;
    const dispatchSpy = vi.spyOn(store, 'dispatch').mockImplementation((action: any) => {
      if (action.type === setMessages.type) {
        throw new Error('Simulated Redux Failure');
      }
      return originalDispatch(action);
    });

    // Write to IDB
    const tx = await dbA.transaction('room_projections', 'readwrite');
    tx.objectStore('room_projections').put({ accountId: ACCOUNT_A, roomId: 'room-1', roomName: 'Room A' });
    await new Promise<void>((res) => tx.oncomplete = () => res());

    // Hydrating will trigger simulated store failure
    await expect(
      projectionSubscriptionService.hydrateFromCanonical(dbA)
    ).rejects.toThrow('Simulated Redux Failure');

    // IDB data must still be successfully committed and intact
    const room = await dbA.get<any>('room_projections', [ACCOUNT_A, 'room-1']);
    expect(room).toBeDefined();
    expect(room.roomName).toBe('Room A');

    dispatchSpy.mockRestore();
  });
});
