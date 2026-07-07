import api, { getAccessToken } from './api';
import { socketService } from './socket';
import { store } from '../store';
import { setRooms, setCurrentRoom } from '../features/rooms/roomsSlice';
import { setFriends, setPendingRequests } from '../features/friends/friendsSlice';
import { 
  setMessages, 
  upsertMessage, 
  reconcileConfirmedMessage,
  updateMessage, 
  deleteMessage, 
  updateMessageReactions 
} from '../features/chat/chatSlice';
import { updateUser, logout } from '../features/auth/authSlice';
import { CryptoService } from './cryptoService';
import localDb from './indexedDb';

interface QueuedMessage {
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  iv?: string;
  clientMsgId: string;
  type: string;
  replyTo?: string;
  mediaUrl?: string;
  mediaFilename?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  mediaKey?: string;
  mediaIv?: string;
  actionType: 'send' | 'edit' | 'delete' | 'react';
  reactionEmoji?: string;
  deleteForEveryone?: boolean;
  retryCount: number;
}

class SyncManager {
  private isProcessingQueue = false;
  private isSyncing = false;
  private isInitialized = false;

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Listen to online/offline browser changes
    window.addEventListener('online', () => {
      console.log('[SyncManager] Browser online, triggering sync and queue processing...');
      this.syncOnReconnect();
    });

    // Listen to socket connection events
    const socket = socketService.connect();
    if (socket) {
      socket.on('connect', () => {
        console.log('[SyncManager] Socket connected, triggering sync and queue processing...');
        this.syncOnReconnect();
      });
    }
  }

  async bootstrap(): Promise<void> {
    console.log('[SyncManager] Starting bootstrap sequence...');
    const token = getAccessToken();
    if (!token) {
      store.dispatch(logout());
      return;
    }

    try {
      // 1. Verify Session
      const { data } = await api.get('/auth/me');
      const currentUser = data.data.user;
      store.dispatch(updateUser(currentUser));

      // 2. Connect socket
      socketService.connect();
      await socketService.waitForConnection();

      // 3. Fetch rooms & friends in parallel
      const [roomsRes, friendsRes, requestsRes] = await Promise.all([
        api.get('/rooms'),
        api.get('/friends/list'),
        api.get('/friends/requests')
      ]);

      const rooms = roomsRes.data.data.rooms;
      store.dispatch(setRooms(rooms));
      store.dispatch(setFriends(friendsRes.data.data.friends || []));
      store.dispatch(setPendingRequests(requestsRes.data.data.requests || []));

      // 4. Restore last opened room
      const savedRoomId = localStorage.getItem('last_active_room_id');
      if (savedRoomId) {
        const activeRoom = rooms.find((r: any) => r.roomId === savedRoomId);
        if (activeRoom) {
          store.dispatch(setCurrentRoom(activeRoom));
          
          // Initial messages fetch
          const msgsRes = await api.get(`/messages/${savedRoomId}`);
          const fetchedMessages = msgsRes.data.data.messages;
          
          // Decrypt messages
          const roomKey = await this.getRoomKey(savedRoomId, activeRoom.encryptedRoomKeys);
          const decrypted = await Promise.all(
            fetchedMessages.map(async (msg: any) => {
              let decryptedContent = msg.content;
              if (roomKey && msg.content && msg.type === 'text') {
                decryptedContent = await CryptoService.decryptMessage(msg.content, msg.iv, roomKey);
              }
              return { ...msg, content: decryptedContent };
            })
          );
          store.dispatch(setMessages(decrypted));
        }
      }
      
      this.init(); // Setup event listeners
      this.processQueue(); // Process any pending queued operations in IndexedDB
      
      console.log('[SyncManager] Bootstrap sequence completed successfully.');
    } catch (error) {
      console.error('[SyncManager] Bootstrap sequence failed:', error);
      if ((error as any)?.response?.status === 401) {
        store.dispatch(logout());
      }
    }
  }

  async syncOnReconnect() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    console.log('[SyncManager] Reconnection sync started...');

    try {
      // 1. Fetch updated rooms in background
      const roomsRes = await api.get('/rooms');
      const rooms = roomsRes.data.data.rooms;
      store.dispatch(setRooms(rooms));

      // 2. Fetch updated friends list
      const friendsRes = await api.get('/friends/list');
      store.dispatch(setFriends(friendsRes.data.data.friends || []));

      // 3. Re-join all rooms
      socketService.connect();

      // 4. Incremental message sync for active room using sinceId
      const state = store.getState();
      const currentRoom = state.rooms.currentRoom;
      const messages = state.chat.messages;

      if (currentRoom && messages.length > 0) {
        const lastRealMsg = [...messages].reverse().find(m => m._id && !m.isOptimistic);
        if (lastRealMsg) {
          console.log('[SyncManager] Fetching incremental messages since ID:', lastRealMsg._id);
          const msgsRes = await api.get(`/messages/${currentRoom.roomId}?sinceId=${lastRealMsg._id}`);
          const newMessages = msgsRes.data.data.messages;

          if (newMessages.length > 0) {
            const roomKey = await this.getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
            const decryptedNewMsgs = await Promise.all(
              newMessages.map(async (msg: any) => {
                let decryptedContent = msg.content;
                if (roomKey && msg.content && msg.type === 'text') {
                  decryptedContent = await CryptoService.decryptMessage(msg.content, msg.iv, roomKey);
                }
                return { ...msg, content: decryptedContent };
              })
            );
            
            decryptedNewMsgs.forEach(msg => {
              store.dispatch(upsertMessage(msg));
            });
          }
        }
      }

      // 5. Process offline outgoing queue
      this.processQueue();
    } catch (e) {
      console.error('[SyncManager] Sync failed:', e);
    } finally {
      this.isSyncing = false;
    }
  }

  async enqueueMessage(msgPayload: Omit<QueuedMessage, 'retryCount'>) {
    const storeName = await localDb.getActiveQueueStoreName();
    let queuedItem: any;

    if (storeName === 'offline_queue_v2') {
      let seq = 0;
      try {
        const seqMeta = await localDb.get('sync_meta', 'queue_seq');
        seq = (seqMeta?.value || 0) + 1;
      } catch {}
      await localDb.put('sync_meta', { key: 'queue_seq', value: seq });

      queuedItem = {
        ...msgPayload,
        queueId: msgPayload.clientMsgId || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2)),
        createdAt: Date.now(),
        sequenceNumber: seq,
        status: 'pending',
        processingStartedAt: null,
        leaseExpiresAt: null,
        nextAttemptAt: Date.now(),
        lastError: null,
        retryCount: 0,
        operationVersion: 1
      };
    } else {
      queuedItem = { ...msgPayload, retryCount: 0 };
    }
    
    // Save operation to IndexedDB
    await localDb.put(storeName, queuedItem);

    // Apply optimistic updates immediately to the UI
    if (msgPayload.actionType === 'react') {
      const state = store.getState();
      const msgId = msgPayload.clientMsgId;
      const targetMsg = state.chat.messages.find(m => m.messageId === msgId || m._id === msgId);
      if (targetMsg) {
        const reactions = targetMsg.reactions || [];
        const index = reactions.findIndex((r: any) => r.userId === msgPayload.senderId && r.emoji === msgPayload.reactionEmoji);
        let updatedReactions = [...reactions];
        if (index !== -1) {
          updatedReactions.splice(index, 1);
        } else {
          updatedReactions.push({ emoji: msgPayload.reactionEmoji!, userId: msgPayload.senderId, createdAt: new Date().toISOString() });
        }
        store.dispatch(updateMessageReactions({ messageId: msgId, reactions: updatedReactions }));
      }
    } else if (msgPayload.actionType === 'edit') {
      store.dispatch(updateMessage({
        messageId: msgPayload.clientMsgId,
        content: msgPayload.content,
        editedAt: new Date().toISOString()
      }));
    } else if (msgPayload.actionType === 'delete') {
      store.dispatch(deleteMessage({
        messageId: msgPayload.clientMsgId,
        deletedForEveryone: msgPayload.deleteForEveryone || false
      }));
    } else {
      const optimisticMsg = {
        messageId: queuedItem.clientMsgId,
        clientMsgId: queuedItem.clientMsgId,
        senderId: queuedItem.senderId,
        senderName: queuedItem.senderName,
        roomId: queuedItem.roomId,
        content: queuedItem.content,
        timestamp: new Date().toISOString(),
        type: queuedItem.type,
        mediaFilename: queuedItem.mediaFilename,
        mediaSize: queuedItem.mediaSize,
        replyTo: queuedItem.replyTo,
        isOptimistic: true
      } as any;
      store.dispatch(upsertMessage(optimisticMsg));
    }

    // Process the queue asynchronously
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      const storeName = await localDb.getActiveQueueStoreName();
      let queue = await localDb.getAll(storeName);
      
      if (storeName === 'offline_queue_v2') {
        const now = Date.now();
        // 1. Reclaim expired leases
        for (const item of queue) {
          if (item.status === 'processing' && item.leaseExpiresAt && item.leaseExpiresAt < now) {
            item.status = 'pending';
            item.processingStartedAt = null;
            item.leaseExpiresAt = null;
            await localDb.put(storeName, item);
          }
        }

        // 2. Filter and sort active queue items (pending or retry_wait)
        const activeItems = queue.filter(item => 
          (item.status === 'pending' || item.status === 'retry_wait') && 
          item.nextAttemptAt <= now
        );

        activeItems.sort((a, b) => {
          if (a.createdAt !== b.createdAt) {
            return a.createdAt - b.createdAt;
          }
          return a.sequenceNumber - b.sequenceNumber;
        });

        for (const item of activeItems) {
          if (!navigator.onLine || !socketService.connect()?.connected) {
            console.log('[SyncManager] Browser is offline or socket disconnected, pausing queue.');
            break;
          }

          console.log(`[SyncManager] Processing queue item: ${item.queueId} (${item.actionType})`);

          // Acquire lease
          item.status = 'processing';
          item.processingStartedAt = Date.now();
          item.leaseExpiresAt = Date.now() + 30000;
          await localDb.put(storeName, item);

          try {
            let ackResult: any;

            if (item.actionType === 'react') {
              socketService.reactToMessage({
                messageId: item.clientMsgId,
                roomId: item.roomId,
                emoji: item.reactionEmoji!
              });
              ackResult = { ok: true };
            } else if (item.actionType === 'edit') {
              socketService.editMessage({
                messageId: item.clientMsgId,
                roomId: item.roomId,
                content: item.content,
                iv: item.iv
              });
              ackResult = { ok: true };
            } else if (item.actionType === 'delete') {
              socketService.deleteMessage({
                messageId: item.clientMsgId,
                roomId: item.roomId,
                deleteForEveryone: item.deleteForEveryone || false
              });
              ackResult = { ok: true };
            } else {
              // Wait for structured ACK callback with a 10-second timeout
              ackResult = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  reject(new Error('ACK timeout'));
                }, 10000);

                socketService.sendMessage({
                  roomId: item.roomId,
                  senderId: item.senderId,
                  senderName: item.senderName,
                  content: item.content,
                  iv: item.iv,
                  clientMsgId: item.clientMsgId,
                  type: item.type,
                  mediaUrl: item.mediaUrl,
                  mediaFilename: item.mediaFilename,
                  mediaMimeType: item.mediaMimeType,
                  mediaSize: item.mediaSize,
                  mediaKey: item.mediaKey,
                  mediaIv: item.mediaIv,
                  replyTo: item.replyTo
                }, (response: any) => {
                  clearTimeout(timeout);
                  resolve(response);
                });
              });
            }

            if (ackResult && ackResult.ok) {
              // Reconcile if it was a message send and server returned the persisted document
              if (item.actionType === 'send' && ackResult.message) {
                store.dispatch(reconcileConfirmedMessage({
                  clientMsgId: item.clientMsgId,
                  serverMessage: ackResult.message
                }));
              }

              // Successfully processed. Remove from IndexedDB
              await localDb.delete(storeName, item.queueId);
            } else {
              const errCode = ackResult?.errorCode || 'FAILED_ACK';
              console.error(`[SyncManager] Queue item processing rejected: ${errCode}`);

              const isPermanent = ['NOT_MEMBER', 'FORBIDDEN', 'INVALID_PAYLOAD', 'TARGET_DELETED', 'CONFLICT_UNRESOLVABLE'].includes(errCode);
              if (isPermanent) {
                item.status = 'failed_permanent';
                item.lastError = errCode;
                await localDb.put(storeName, item);
              } else {
                throw new Error(`Retryable socket ACK error: ${errCode}`);
              }
            }
          } catch (err: any) {
            console.error('[SyncManager] Failed to process queue item:', err);
            item.retryCount++;
            item.status = 'retry_wait';
            item.lastError = err.message || String(err);
            const backoff = Math.min(30000, 1000 * Math.pow(2, item.retryCount) * (0.5 + Math.random() * 0.5));
            item.nextAttemptAt = Date.now() + backoff;
            await localDb.put(storeName, item);
          }
        }
      } else {
        // v1 fallback
        while (queue.length > 0) {
          if (!navigator.onLine || !socketService.connect()?.connected) {
            console.log('[SyncManager] Browser is offline or socket disconnected, pausing queue.');
            break;
          }

          const item = queue[0];
          console.log(`[SyncManager] Processing queue item: ${item.clientMsgId} (${item.actionType})`);

          try {
            let ackResult: any;

            if (item.actionType === 'react') {
              socketService.reactToMessage({
                messageId: item.clientMsgId,
                roomId: item.roomId,
                emoji: item.reactionEmoji!
              });
              ackResult = { ok: true };
            } else if (item.actionType === 'edit') {
              socketService.editMessage({
                messageId: item.clientMsgId,
                roomId: item.roomId,
                content: item.content,
                iv: item.iv
              });
              ackResult = { ok: true };
            } else if (item.actionType === 'delete') {
              socketService.deleteMessage({
                messageId: item.clientMsgId,
                roomId: item.roomId,
                deleteForEveryone: item.deleteForEveryone || false
              });
              ackResult = { ok: true };
            } else {
              // Wait for structured ACK callback with a 10-second timeout
              ackResult = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  reject(new Error('ACK timeout'));
                }, 10000);

                socketService.sendMessage({
                  roomId: item.roomId,
                  senderId: item.senderId,
                  senderName: item.senderName,
                  content: item.content,
                  iv: item.iv,
                  clientMsgId: item.clientMsgId,
                  type: item.type,
                  mediaUrl: item.mediaUrl,
                  mediaFilename: item.mediaFilename,
                  mediaMimeType: item.mediaMimeType,
                  mediaSize: item.mediaSize,
                  mediaKey: item.mediaKey,
                  mediaIv: item.mediaIv,
                  replyTo: item.replyTo
                }, (response: any) => {
                  clearTimeout(timeout);
                  resolve(response);
                });
              });
            }

            if (ackResult && ackResult.ok) {
              // Reconcile if it was a message send and server returned the persisted document
              if (item.actionType === 'send' && ackResult.message) {
                store.dispatch(reconcileConfirmedMessage({
                  clientMsgId: item.clientMsgId,
                  serverMessage: ackResult.message
                }));
              }

              // Successfully processed. Remove from IndexedDB and memory queue.
              await localDb.delete(storeName, item.clientMsgId);
              queue.shift();
            } else {
              const errCode = ackResult?.errorCode || 'FAILED_ACK';
              console.error(`[SyncManager] Queue item processing rejected: ${errCode}`);

              const isPermanent = ['NOT_MEMBER', 'FORBIDDEN', 'INVALID_PAYLOAD', 'TARGET_DELETED', 'CONFLICT_UNRESOLVABLE'].includes(errCode);
              if (isPermanent) {
                await localDb.delete(storeName, item.clientMsgId);
                queue.shift();
              } else {
                throw new Error(`Retryable socket ACK error: ${errCode}`);
              }
            }
          } catch (err) {
            console.error('[SyncManager] Failed to process queue item:', err);
            item.retryCount++;
            
            if (item.retryCount > 5) {
              // Remove poison/failed operations after 5 attempts
              await localDb.delete(storeName, item.clientMsgId);
              queue.shift();
            } else {
              await localDb.put(storeName, item);
              
              // Wait with exponential backoff before the next check cycle
              const backoff = Math.min(10000, 1000 * Math.pow(2, item.retryCount));
              await new Promise(resolve => setTimeout(resolve, backoff));
            }
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async getRoomKey(roomId: string, encryptedRoomKeys: any) {
    const state = store.getState();
    const token = state.auth.token;
    if (!token) return null;
    try {
      const savedKey = localStorage.getItem(`room_key_${roomId}`);
      if (savedKey) {
        return await CryptoService.importRoomKey(savedKey);
      }
      
      const privKeyBase64 = localStorage.getItem('e2e_private_key');
      if (privKeyBase64 && encryptedRoomKeys) {
        const user = state.auth.user;
        const myEncKey = encryptedRoomKeys[user?._id || ''];
        if (myEncKey) {
          const privKey = await CryptoService.importPrivateKey(privKeyBase64);
          const roomKeyStr = await CryptoService.decryptRoomKey(myEncKey, privKey);
          localStorage.setItem(`room_key_${roomId}`, roomKeyStr);
          return await CryptoService.importRoomKey(roomKeyStr);
        }
      }
    } catch (e) {
      console.error('Failed to recover room key inside SyncManager', e);
    }
    return null;
  }
}

export const syncManager = new SyncManager();
