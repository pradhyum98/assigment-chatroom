import { CanonicalDatabase } from './CanonicalDatabase';
import { EventContractRegistry } from './EventContracts';
import type { RoomEventEnvelope, UserEventEnvelope } from './EventContracts';
import { EventProjectionHandlers } from './EventProjectionHandlers';
import { projectionSubscriptionService } from './ProjectionSubscriptionService';
import type { ProjectionChangeSet } from './ProjectionSubscriptionService';
import { store } from '../store';
import { removeOptimisticMutation } from '../features/chat/chatSlice';

export class CanonicalReconciler {
  private db: CanonicalDatabase;
  constructor(db: CanonicalDatabase) {
    this.db = db;
  }

  async applyRoomEvent(event: RoomEventEnvelope): Promise<void> {
    const accountId = this.db.getAccountId();
    const eventId = `room_${event.roomId}_${event.sequenceNumber}`;

    const tx = await this.db.transaction([
      'room_events',
      'room_cursors',
      'room_projections',
      'message_projections',
      'membership_projections',
      'processed_events',
      'offline_queue_v3'
    ], 'readwrite');

    const changes: ProjectionChangeSet = [];

    return new Promise((resolve, reject) => {
      // 1. Check duplicate via processed marker
      const processedStore = tx.objectStore('processed_events');
      const checkReq = processedStore.get([accountId, eventId]);

      checkReq.onsuccess = async () => {
        if (checkReq.result) {
          // Duplicate, silently ignore
          resolve();
          return;
        }

        // 2. Validate contract and version
        const contract = EventContractRegistry[event.eventType];
        if (!contract || contract.streamType !== 'room') {
          // Unknown or mismatched type - in a real app might set CLIENT_UPGRADE_REQUIRED state
          console.warn(`[CanonicalReconciler] Unknown RoomEvent type: ${event.eventType}`);
          resolve();
          return;
        }

        if (event.eventVersion > contract.eventVersion) {
          // Unsafe to proceed, mark CLIENT_UPGRADE_REQUIRED (we'll implement this properly later)
          console.error(`[CanonicalReconciler] CLIENT_UPGRADE_REQUIRED for ${event.eventType}`);
          reject(new Error('CLIENT_UPGRADE_REQUIRED'));
          return;
        }

        try {
          // 3. Delegate to projection handler
          // Instead of dynamic import, we'll import handlers directly or call them via a registry.
          // For now, we simulate the call to avoid circular dependency.
          await (EventProjectionHandlers[contract.handlerName as keyof typeof EventProjectionHandlers] as any)(this, tx, event, event.payload, changes);
          
          // Clean up matched outbox entries
          for (const change of changes) {
            if (change.type === 'OPTIMISTIC_RESOLVED' && change.payload.clientMsgId) {
              tx.objectStore('offline_queue_v3').delete([accountId, change.payload.clientMsgId]);
            }
          }

          // 4. Persist Canonical Event
          const eventsStore = tx.objectStore('room_events');
          eventsStore.put({
            accountId,
            roomId: event.roomId,
            sequenceNumber: event.sequenceNumber,
            eventType: event.eventType,
            eventVersion: event.eventVersion,
            actorId: event.actorId,
            payload: event.payload,
            createdAt: event.createdAt
          });

          // 5. Persist Processed Marker
          processedStore.put({ accountId, eventId, timestamp: new Date().toISOString() });

          // 6. Advance Cursor
          const cursorStore = tx.objectStore('room_cursors');
          const cursorReq = cursorStore.get([accountId, event.roomId]);
          cursorReq.onsuccess = () => {
            const current = cursorReq.result || { accountId, roomId: event.roomId, lastContiguousSequence: 0 };
            if (event.sequenceNumber === current.lastContiguousSequence + 1) {
              current.lastContiguousSequence = event.sequenceNumber;
              current.latestKnownServerSequence = Math.max(current.latestKnownServerSequence || 0, event.sequenceNumber);
              current.updatedAt = new Date().toISOString();
              cursorStore.put(current);
            }
          };

        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      
      checkReq.onerror = () => {
        console.error('[CanonicalReconciler] checkReq error:', checkReq.error);
        reject(checkReq.error);
      };
      tx.oncomplete = () => {
        // Dispatch canonical changes to Redux AFTER commit
        const syncChanges = changes.filter(c => c.type !== 'OPTIMISTIC_RESOLVED');
        if (syncChanges.length > 0) {
          projectionSubscriptionService.notifyChanges(syncChanges);
        }
        // Remove optimistic overlay for any resolved mutations
        changes
          .filter(c => c.type === 'OPTIMISTIC_RESOLVED')
          .forEach(c => {
            store.dispatch(removeOptimisticMutation(c.payload.clientMsgId));
          });
        resolve();
      };
      tx.onerror = () => {
        console.error('[CanonicalReconciler] Transaction aborted/failed for event:', event.eventType, 'seq:', event.sequenceNumber, tx.error);
        reject(tx.error);
      };
    });
  }

  async applyUserEvent(event: UserEventEnvelope): Promise<void> {
    const accountId = this.db.getAccountId();
    const eventId = `user_${accountId}_${event.sequenceNumber}`;

    const tx = await this.db.transaction([
      'user_events',
      'user_cursor',
      'room_projections',
      'membership_projections',
      'processed_events',
      'cleanup_intents'
    ], 'readwrite');

    const changes: ProjectionChangeSet = [];

    return new Promise((resolve, reject) => {
      const processedStore = tx.objectStore('processed_events');
      const checkReq = processedStore.get([accountId, eventId]);

      checkReq.onsuccess = async () => {
        if (checkReq.result) {
          resolve();
          return;
        }

        const contract = EventContractRegistry[event.eventType];
        if (!contract || contract.streamType !== 'user') {
          console.warn(`[CanonicalReconciler] Unknown UserEvent type: ${event.eventType}`);
          resolve();
          return;
        }

        if (event.eventVersion > contract.eventVersion) {
          console.error(`[CanonicalReconciler] CLIENT_UPGRADE_REQUIRED for ${event.eventType}`);
          reject(new Error('CLIENT_UPGRADE_REQUIRED'));
          return;
        }

        try {
          await (EventProjectionHandlers[contract.handlerName as keyof typeof EventProjectionHandlers] as any)(this, tx, event, event.payload, changes);

          const eventsStore = tx.objectStore('user_events');
          eventsStore.put({
            accountId,
            sequenceNumber: event.sequenceNumber,
            eventType: event.eventType,
            eventVersion: event.eventVersion,
            payload: event.payload,
            createdAt: event.createdAt
          });

          processedStore.put({ accountId, eventId, timestamp: new Date().toISOString() });

          const cursorStore = tx.objectStore('user_cursor');
          const cursorReq = cursorStore.get(accountId);
          cursorReq.onsuccess = () => {
            const current = cursorReq.result || { accountId, lastContiguousSequence: 0 };
            if (event.sequenceNumber === current.lastContiguousSequence + 1) {
              current.lastContiguousSequence = event.sequenceNumber;
              cursorStore.put(current);
            }
          };

        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      
      checkReq.onerror = () => reject(checkReq.error);
      tx.oncomplete = () => {
        const syncChanges = changes.filter(c => c.type !== 'OPTIMISTIC_RESOLVED');
        if (syncChanges.length > 0) {
          projectionSubscriptionService.notifyChanges(syncChanges);
        }
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // Abstracted out so handlers can call it if they need to read projections
  getProjection(tx: IDBTransaction, storeName: string, key: any): Promise<any> {
    const store = tx.objectStore(storeName);
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  putProjection(tx: IDBTransaction, storeName: string, item: any): void {
    const store = tx.objectStore(storeName);
    store.put(item);
  }

  deleteProjection(tx: IDBTransaction, storeName: string, key: any): void {
    const store = tx.objectStore(storeName);
    store.delete(key);
  }


}
