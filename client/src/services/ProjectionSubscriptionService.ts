import { store } from '../store';
import { setMessages, addMessage, updateMessage, deleteMessage } from '../features/chat/chatSlice';
import { setRooms, updateRoom, removeRoom } from '../features/rooms/roomsSlice';
import { socketService } from './socket';

export type ProjectionChangeSet = {
  type: string;
  payload: any;
}[];

export class ProjectionSubscriptionService {
  constructor() {}

  notifyChanges(changes: ProjectionChangeSet) {
    const currentUserId = store.getState().auth.user?._id;
    const deliveryReceiptsByRoom: Record<string, string[]> = {};

    changes.forEach(change => {
      switch (change.type) {
        case 'MESSAGE_INSERTED': {
          store.dispatch(addMessage(change.payload));
          
          if (currentUserId && change.payload.senderId !== currentUserId) {
            const rId = change.payload.roomId;
            const mId = change.payload.messageId || change.payload._id;
            if (rId && mId) {
              if (!deliveryReceiptsByRoom[rId]) deliveryReceiptsByRoom[rId] = [];
              deliveryReceiptsByRoom[rId].push(mId);
            }
          }
          break;
        }
        case 'MESSAGE_UPDATED':
          store.dispatch(updateMessage({
            messageId: change.payload.messageId || change.payload._id,
            content: change.payload.content,
            editedAt: change.payload.editedAt,
            readBy: change.payload.readBy,
            deliveredTo: change.payload.deliveredTo,
            reactions: change.payload.reactions
          }));
          break;
        case 'MESSAGE_REMOVED':
          store.dispatch(deleteMessage({
            messageId: change.payload.messageId || change.payload._id,
            deletedForEveryone: true
          }));
          break;
        case 'ROOM_UPDATED':
          store.dispatch(updateRoom(change.payload));
          break;
        case 'ROOM_REMOVED':
          store.dispatch(removeRoom(change.payload.roomId));
          break;
        case 'SNAPSHOT_GENERATION_ACTIVATED':
          // Re-hydrate the entire room from IndexedDB
          break;
      }
    });

    // Send delivery receipts in bulk per room
    Object.entries(deliveryReceiptsByRoom).forEach(([roomId, messageIds]) => {
      socketService.markAsDelivered({ roomId, messageIds });
    });
  }

  async hydrateFromCanonical(db: any) {
    const accountId = db.getAccountId();
    
    // Read all rooms
    const rooms = await db.getAll('room_projections', IDBKeyRange.bound([accountId, ''], [accountId, '\uffff']));
    store.dispatch(setRooms(rooms));
    
    // For a real app we might not want to load all messages for all rooms into memory.
    // We would lazy load them via a hook. But for compatibility with legacy Redux:
    const msgs = await db.getAll('message_projections', IDBKeyRange.bound([accountId, ''], [accountId, '\uffff']));
    
    // Group by room
    const msgsByRoom: Record<string, any[]> = {};
    for (const m of msgs) {
      if (!msgsByRoom[m.roomId]) msgsByRoom[m.roomId] = [];
      msgsByRoom[m.roomId].push(m);
    }
    
    // In a real app we might only setMessages for the current room
    store.dispatch(setMessages(msgs));
  }

  syncPendingDeliveryReceipts() {
    const state = store.getState();
    const currentUserId = state.auth.user?._id;
    if (!currentUserId) return;

    const deliveryReceiptsByRoom: Record<string, string[]> = {};
    state.chat.messages.forEach((m: any) => {
      if (m.senderId !== currentUserId) {
        const isAlreadyDelivered = m.deliveredTo?.some(
          (d: any) => (d.userId?._id || d.userId || '').toString() === currentUserId
        );
        if (!isAlreadyDelivered) {
          const rId = m.roomId;
          const mId = m.messageId || m._id;
          if (rId && mId) {
            if (!deliveryReceiptsByRoom[rId]) deliveryReceiptsByRoom[rId] = [];
            deliveryReceiptsByRoom[rId].push(mId);
          }
        }
      }
    });

    Object.entries(deliveryReceiptsByRoom).forEach(([roomId, messageIds]) => {
      socketService.markAsDelivered({ roomId, messageIds });
    });
  }
}

export const projectionSubscriptionService = new ProjectionSubscriptionService();
