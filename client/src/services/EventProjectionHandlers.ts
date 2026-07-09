import { CanonicalReconciler } from './CanonicalReconciler';
import type { RoomEventEnvelope, UserEventEnvelope } from './EventContracts';
import type { ProjectionChangeSet } from './ProjectionSubscriptionService';

export const EventProjectionHandlers = {

  // --- Room Events ---

  async handleMessageCreated(reconciler: CanonicalReconciler, tx: IDBTransaction, _event: RoomEventEnvelope, payload: any, changes: ProjectionChangeSet) {
    const accountId = (reconciler as any).db.getAccountId();
    const messageProjection = { ...payload.message ?? payload, accountId };
    reconciler.putProjection(tx, 'message_projections', messageProjection);
    changes.push({ type: 'MESSAGE_INSERTED', payload: messageProjection });
    // Signal clientMsgId so SyncEngine can remove the optimistic overlay
    if (payload.clientMsgId) {
      changes.push({ type: 'OPTIMISTIC_RESOLVED', payload: { clientMsgId: payload.clientMsgId } });
    }
  },

  async handleMessageEdited(reconciler: CanonicalReconciler, tx: IDBTransaction, _event: RoomEventEnvelope, payload: any, changes: ProjectionChangeSet) {
    const accountId = (reconciler as any).db.getAccountId();
    const existing = await reconciler.getProjection(tx, 'message_projections', [accountId, payload.messageId]);
    if (existing) {
      existing.content = payload.newContent;
      reconciler.putProjection(tx, 'message_projections', existing);
      changes.push({ type: 'MESSAGE_UPDATED', payload: existing });
    }
  },

  async handleMessageDeleted(reconciler: CanonicalReconciler, tx: IDBTransaction, _event: RoomEventEnvelope, payload: any, changes: ProjectionChangeSet) {
    const accountId = (reconciler as any).db.getAccountId();
    const existing = await reconciler.getProjection(tx, 'message_projections', [accountId, payload.messageId]);
    if (existing) {
      reconciler.deleteProjection(tx, 'message_projections', [accountId, payload.messageId]);
      changes.push({ type: 'MESSAGE_REMOVED', payload: existing });
    }
  },

  async handleReactionChanged(reconciler: CanonicalReconciler, tx: IDBTransaction, _event: RoomEventEnvelope, payload: any, changes: ProjectionChangeSet) {
    const accountId = (reconciler as any).db.getAccountId();
    const existing = await reconciler.getProjection(tx, 'message_projections', [accountId, payload.messageId]);
    if (existing) {
      // Modify reactions
      reconciler.putProjection(tx, 'message_projections', existing);
      changes.push({ type: 'MESSAGE_UPDATED', payload: existing });
    }
  },

  async handleReadUpdated(_reconciler: CanonicalReconciler, _tx: IDBTransaction, _event: RoomEventEnvelope, _payload: any, _changes: ProjectionChangeSet) {
    // Update read receipts
  },

  async handleDeliveryUpdated(_reconciler: CanonicalReconciler, _tx: IDBTransaction, _event: RoomEventEnvelope, _payload: any, _changes: ProjectionChangeSet) {
    // Update delivery receipts
  },

  async handleRoomMetadataChanged(reconciler: CanonicalReconciler, tx: IDBTransaction, event: RoomEventEnvelope, payload: any) {
    const accountId = (reconciler as any).db.getAccountId();
    const room = await reconciler.getProjection(tx, 'room_projections', [accountId, event.roomId]);
    if (room) {
      if (payload.roomName) room.roomName = payload.roomName;
      if (payload.description) room.description = payload.description;
      if (payload.avatarColor) room.avatarColor = payload.avatarColor;
      reconciler.putProjection(tx, 'room_projections', room);
    }
  },

  async handleMembershipChanged(_reconciler: CanonicalReconciler, _tx: IDBTransaction, _event: RoomEventEnvelope, _payload: any, _changes: ProjectionChangeSet) {
    // Update membership_projections
  },

  async handleAdminChanged(_reconciler: CanonicalReconciler, _tx: IDBTransaction, _event: RoomEventEnvelope, _payload: any, _changes: ProjectionChangeSet) {
    // Update admins
  },

  async handlePinnedMessagesChanged(_reconciler: CanonicalReconciler, _tx: IDBTransaction, _event: RoomEventEnvelope, _payload: any, _changes: ProjectionChangeSet) {
    // Update pinned messages
  },

  async handleIdentityChanged(_reconciler: CanonicalReconciler, _tx: IDBTransaction, _event: RoomEventEnvelope, _payload: any, _changes: ProjectionChangeSet) {
    // Update user identity mapping
  },

  async handleRoomKeyRotationRequired(reconciler: CanonicalReconciler, tx: IDBTransaction, event: RoomEventEnvelope, _payload: any, changes: ProjectionChangeSet) {
    const accountId = (reconciler as any).db.getAccountId();
    const room = await reconciler.getProjection(tx, 'room_projections', [accountId, event.roomId]);
    if (room) {
      room.cryptoState = 'ROTATION_REQUIRED';
      reconciler.putProjection(tx, 'room_projections', room);
      changes.push({ type: 'ROOM_UPDATED', payload: room });
    }
  },

  async handleRoomKeyRotated(reconciler: CanonicalReconciler, tx: IDBTransaction, event: RoomEventEnvelope, _payload: any) {
    const accountId = (reconciler as any).db.getAccountId();
    const room = await reconciler.getProjection(tx, 'room_projections', [accountId, event.roomId]);
    if (room) {
      room.syncState = 'READY';
      reconciler.putProjection(tx, 'room_projections', room);
    }
  },

  async handleGroupMetadataUpdated(reconciler: CanonicalReconciler, tx: IDBTransaction, event: RoomEventEnvelope, payload: any, changes: ProjectionChangeSet) {
    const accountId = (reconciler as any).db.getAccountId();
    const existing = await reconciler.getProjection(tx, 'room_projections', [accountId, event.roomId]);
    if (existing) {
      Object.assign(existing, payload);
      reconciler.putProjection(tx, 'room_projections', existing);
      changes.push({ type: 'ROOM_UPDATED', payload: existing });
    }
  },

  // --- User Events ---

  async handleRoomAccessGranted(reconciler: CanonicalReconciler, tx: IDBTransaction, _event: UserEventEnvelope, payload: any, changes: ProjectionChangeSet) {
    const accountId = (reconciler as any).db.getAccountId();
    const room = {
      accountId,
      ...payload
    };
    reconciler.putProjection(tx, 'room_projections', room);
    changes.push({ type: 'ROOM_UPDATED', payload: room });
  },

  async handleRoomAccessRevoked(reconciler: CanonicalReconciler, tx: IDBTransaction, _event: UserEventEnvelope, payload: any, changes: ProjectionChangeSet) {
    const accountId = (reconciler as any).db.getAccountId();
    reconciler.deleteProjection(tx, 'room_projections', [accountId, payload.roomId]);
    changes.push({ type: 'ROOM_REMOVED', payload: { roomId: payload.roomId } });

    const intentsStore = tx.objectStore('cleanup_intents');
    intentsStore.put({
      accountId,
      intentId: `purge_room_${payload.roomId}`,
      type: 'PURGE_ROOM',
      payload: { roomId: payload.roomId },
      status: 'PENDING',
      createdAt: new Date().toISOString()
    });
  },

  async handleRoomDeleted(reconciler: CanonicalReconciler, tx: IDBTransaction, event: UserEventEnvelope, payload: any) {
    const accountId = (reconciler as any).db.getAccountId();
    reconciler.deleteProjection(tx, 'room_projections', [accountId, payload.roomId]);
    
    reconciler.putProjection(tx, 'cleanup_intents', {
      accountId,
      intentId: `DELETE_${payload.roomId}_${event.sequenceNumber}`,
      type: 'ROOM_DELETED',
      payload: { roomId: payload.roomId },
      status: 'PENDING'
    });
  },

  async handleIdentityReset(reconciler: CanonicalReconciler, tx: IDBTransaction, _event: UserEventEnvelope, _payload: any, _changes: ProjectionChangeSet) {
    const accountId = (reconciler as any).db.getAccountId();
    const intentsStore = tx.objectStore('cleanup_intents');
    intentsStore.put({
      accountId,
      intentId: `purge_secrets_${Date.now()}`,
      type: 'PURGE_ALL_SECRETS',
      payload: {},
      status: 'PENDING',
      createdAt: new Date().toISOString()
    });
  },

  async handleSessionSecurity(_reconciler: CanonicalReconciler, _tx: IDBTransaction, _event: UserEventEnvelope, _payload: any, _changes: ProjectionChangeSet) {
    // Handle session security (e.g., logging out other devices)
  }
};
