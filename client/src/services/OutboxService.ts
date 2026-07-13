import { CanonicalDatabase } from './CanonicalDatabase';
import { store } from '../store';
import { updateOptimisticMutationStatus, removeOptimisticMutation } from '../features/chat/chatSlice';
import { socketService } from './socket';

export type OutboxStatus = 
  | 'PENDING' 
  | 'VALIDATING' 
  | 'REENCRYPT_REQUIRED' 
  | 'SENDING' 
  | 'ACKNOWLEDGED' 
  | 'RETRYABLE_FAILURE' 
  | 'PERMANENTLY_REJECTED' 
  | 'QUARANTINED';

export interface OutboxItem {
  accountId: string;
  mutationId: string;
  clientMsgId?: string;
  roomId: string;
  actionType: string;
  payload: any;
  createdAt: string;
  order: number;
  attemptCount: number;
  nextAttemptAt: number;
  status: OutboxStatus;
  requiredIdentityVersion?: number;
  requiredRoomKeyVersion?: number;
  requiredMembershipRevision?: number;
  encryptionVersion?: number;
  mediaMetadata?: any;
}

export class OutboxService {
  private db: CanonicalDatabase;
  private cryptoRevalidator: any;
  constructor(db: CanonicalDatabase, cryptoRevalidator: any) {
    this.db = db;
    this.cryptoRevalidator = cryptoRevalidator;
  }

  async enqueueMutation(item: Omit<OutboxItem, 'accountId' | 'order' | 'attemptCount' | 'nextAttemptAt' | 'status'>): Promise<void> {
    const accountId = this.db.getAccountId();
    const tx = await this.db.transaction(['offline_queue_v3', 'sync_meta'], 'readwrite');
    
    return new Promise((resolve, reject) => {
      const metaStore = tx.objectStore('sync_meta');
      const queueStore = tx.objectStore('offline_queue_v3');
      
      const getReq = metaStore.get([accountId, 'outbox_seq']);
      getReq.onsuccess = () => {
        const seq = (getReq.result?.value || 0) + 1;
        metaStore.put({ accountId, key: 'outbox_seq', value: seq });
        
        queueStore.put({
          ...item,
          accountId,
          order: seq,
          attemptCount: 0,
          nextAttemptAt: Date.now(),
          status: 'PENDING'
        });
      };
      
      tx.oncomplete = () => {
        resolve();
        // Immediately try flushing
        this.flush();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async flush(): Promise<void> {
    const accountId = this.db.getAccountId();
    
    // In reality, we'd iterate by index `by_room_order` to process per-room FIFO
    const items = await this.db.getAll<OutboxItem>('offline_queue_v3', IDBKeyRange.bound([accountId, ''], [accountId, '\uffff']));
    const processable = items.filter(i => 
      ['PENDING', 'RETRYABLE_FAILURE', 'SENDING'].includes(i.status) && 
      i.nextAttemptAt <= Date.now()
    );
    
    // Sort by order
    processable.sort((a, b) => a.order - b.order);
    
    const blockedRooms = new Set<string>();

    for (const item of processable) {
      if (blockedRooms.has(item.roomId)) continue;
      
      try {
        await this.processItem(item);
      } catch (err: any) {
        if (err.message === 'ROOM_BLOCKED') {
          blockedRooms.add(item.roomId);
        } else {
          console.error(`[OutboxService] Failed to process mutation ${item.mutationId}:`, err);
        }
      }
    }
  }

  private async processItem(item: OutboxItem): Promise<void> {
    // 1. Transition to VALIDATING
    await this.updateStatus(item.mutationId, 'VALIDATING');
    
    // 2. Validate crypto and access
    const validation = await this.cryptoRevalidator.validate(item);
    
    if (validation.needsReencryption) {
      await this.updateStatus(item.mutationId, 'REENCRYPT_REQUIRED');
      const success = await this.cryptoRevalidator.reencrypt(item);
      if (!success) {
        await this.updateStatus(item.mutationId, 'QUARANTINED');
        throw new Error('ROOM_BLOCKED'); // Don't process anything else for this room
      }
    } else if (!validation.isValid) {
      await this.updateStatus(item.mutationId, 'PERMANENTLY_REJECTED');
      return; // Room isn't necessarily blocked, just this item
    }

    // 3. SENDING
    await this.updateStatus(item.mutationId, 'SENDING');
    
    try {
      const accountId = this.db.getAccountId();
      const room = await this.db.get<any>('room_projections', [accountId, item.roomId]);
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const senderIdentityVersion = currentUser.identityVersion || 1;
      const roomKeyVersion = room?.roomKeyVersion || 1;

      // Real network send via Socket.IO
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('TIMEOUT')), 10000);

        const handleAck = (ack: any) => {
          clearTimeout(timeout);
          if (ack && ack.ok === false) {
            if (ack.retryable === false) {
              reject(new Error('PERMANENT_REJECT'));
            } else {
              reject(new Error('RETRY'));
            }
          } else {
            resolve();
          }
        };

        switch (item.actionType) {
          case 'SEND_MESSAGE':
            socketService.sendMessage({
              clientMsgId: item.clientMsgId,
              roomId: item.roomId,
              senderId: item.payload.senderId,
              senderName: item.payload.senderName,
              content: item.payload.content,
              iv: item.payload.iv,
              type: item.payload.type || 'text',
              timestamp: item.payload.timestamp,
              replyTo: item.payload.replyTo,
              mediaUrl: item.payload.mediaUrl,
              mediaFilename: item.payload.mediaFilename,
              mediaMimeType: item.payload.mediaMimeType,
              mediaSize: item.payload.mediaSize,
              encryptionVersion: item.payload.encryptionVersion,
              wrappedMediaKey: item.payload.wrappedMediaKey,
              mediaKeyIv: item.payload.mediaKeyIv,
              mediaIv: item.payload.mediaIv,
              senderIdentityVersion,
              roomKeyVersion,
            }, handleAck);
            break;
          case 'EDIT_MESSAGE':
            socketService.editMessage({
              messageId: item.payload.messageId,
              roomId: item.roomId,
              content: item.payload.content,
              iv: item.payload.iv,
            });
            clearTimeout(timeout);
            resolve();
            break;
          case 'DELETE_MESSAGE':
            socketService.deleteMessage({
              messageId: item.payload.messageId,
              roomId: item.roomId,
              deleteForEveryone: item.payload.deletedForEveryone,
            });
            clearTimeout(timeout);
            resolve();
            break;
          case 'ADD_REACTION':
          case 'REMOVE_REACTION':
            socketService.reactToMessage({
              messageId: item.payload.messageId,
              roomId: item.roomId,
              emoji: item.payload.emoji,
            });
            clearTimeout(timeout);
            resolve();
            break;
          default:
            // Unknown action — treat as acknowledged so we don't block the queue
            clearTimeout(timeout);
            resolve();
        }
      });

      // 4. ACKNOWLEDGED
      await this.updateStatus(item.mutationId, 'ACKNOWLEDGED');
      
    } catch (networkError: any) {
      if (networkError?.message === 'PERMANENT_REJECT') {
        await this.updateStatus(item.mutationId, 'PERMANENTLY_REJECTED');
        return; // Don't block the room for permanent failures
      }
      // 5. RETRYABLE_FAILURE (TIMEOUT, RETRY, or unknown)
      item.attemptCount++;
      item.nextAttemptAt = Date.now() + Math.min(1000 * Math.pow(2, item.attemptCount), 60000);
      item.status = 'RETRYABLE_FAILURE';
      
      const tx = await this.db.transaction('offline_queue_v3', 'readwrite');
      tx.objectStore('offline_queue_v3').put(item);
      
      throw new Error('ROOM_BLOCKED'); // Stop processing this room to preserve FIFO
    }
  }

  private async updateStatus(mutationId: string, status: OutboxStatus) {
    const accountId = this.db.getAccountId();
    const tx = await this.db.transaction('offline_queue_v3', 'readwrite');
    const storeObj = tx.objectStore('offline_queue_v3');
    
    return new Promise<void>((resolve, reject) => {
      const req = storeObj.get([accountId, mutationId]);
      req.onsuccess = () => {
        const item = req.result;
        if (item) {
          item.status = status;
          storeObj.put(item);
          
          const key = item.clientMsgId || item.mutationId;
          if (status === 'PERMANENTLY_REJECTED') {
            store.dispatch(removeOptimisticMutation(key));
          } else {
            store.dispatch(updateOptimisticMutationStatus({ key, status }));
          }
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }
}
