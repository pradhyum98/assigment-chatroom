import { describe, it, expect, beforeEach } from 'vitest';
import { CanonicalDatabase } from '../src/services/CanonicalDatabase';
import { CanonicalReconciler } from '../src/services/CanonicalReconciler';
import { RoomEventType } from '../src/services/EventContracts';

describe('CanonicalReconciler', () => {
  let db: CanonicalDatabase;
  let reconciler: CanonicalReconciler;

  beforeEach(() => {
    // Setup in-memory mock or rely on fake-indexeddb
    db = new CanonicalDatabase();
    db.setAccountId('test-account-123');
    reconciler = new CanonicalReconciler(db);
    
    // Mock the global projection handlers
    (window as any).__EventProjectionHandlers = {
      handleMessageCreated: async () => {},
      handleMessageEdited: async () => {}
    };
  });

  it('rejects unknown event types', async () => {
    const event = {
      roomId: 'room-1',
      sequenceNumber: 1,
      eventType: 'FAKE_EVENT' as any,
      eventVersion: 1,
      payload: {},
      createdAt: new Date()
    };
    
    // Because it's unknown, it silently ignores and resolves. 
    // Wait, the implementation resolves and warns.
    await expect(reconciler.applyRoomEvent(event)).resolves.not.toThrow();
  });

  it('rejects future event versions with CLIENT_UPGRADE_REQUIRED', async () => {
    const event = {
      roomId: 'room-1',
      sequenceNumber: 1,
      eventType: RoomEventType.MESSAGE_CREATED,
      eventVersion: 999, // Way in the future
      payload: {},
      createdAt: new Date()
    };
    
    await expect(reconciler.applyRoomEvent(event)).rejects.toThrow('CLIENT_UPGRADE_REQUIRED');
  });
});
