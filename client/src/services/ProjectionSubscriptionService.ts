import { store } from '../store';
import { setMessages, addMessage, updateMessage, deleteMessage } from '../features/chat/chatSlice';
import { setRooms, updateRoom, removeRoom } from '../features/rooms/roomsSlice';

export type ProjectionChangeSet = {
  type: string;
  payload: any;
}[];

export class ProjectionSubscriptionService {
  constructor() {}

  notifyChanges(changes: ProjectionChangeSet) {
    changes.forEach(change => {
      switch (change.type) {
        case 'MESSAGE_INSERTED':
          store.dispatch(addMessage(change.payload));
          break;
        case 'MESSAGE_UPDATED':
          store.dispatch(updateMessage({
            messageId: change.payload.messageId || change.payload._id,
            content: change.payload.content,
            editedAt: change.payload.editedAt
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
}

export const projectionSubscriptionService = new ProjectionSubscriptionService();
