import { CanonicalDatabase } from './CanonicalDatabase';
import { store } from '../store';
import { updateOptimisticMutationStatus, removeOptimisticMutation } from '../features/chat/chatSlice';

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
      // Fake network send
      // await api.post('/some/endpoint', item.payload);
      
      // 4. ACKNOWLEDGED
      await this.updateStatus(item.mutationId, 'ACKNOWLEDGED');
      
    } catch (networkError: any) {
      // 5. RETRYABLE_FAILURE
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
