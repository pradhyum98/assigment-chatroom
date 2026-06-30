import api from './api';
import { socketService } from './socket';
import { store } from '../store';
import { setRooms, setCurrentRoom } from '../features/rooms/roomsSlice';
import { setFriends, setPendingRequests } from '../features/friends/friendsSlice';
import { setMessages, addMessage, updateMessageReactions } from '../features/chat/chatSlice';
import { updateUser, logout } from '../features/auth/authSlice';
import { CryptoService } from './cryptoService';

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
  isReaction?: boolean;
  reactionEmoji?: string;
  retryCount: number;
}

class SyncManager {
  private isProcessingQueue = false;
  private isSyncing = false;
  private isInitialized = false;

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Listen to online events
    window.addEventListener('online', () => {
      console.log('[SyncManager] Browser online, processing offline queue...');
      this.syncOnReconnect();
    });

    // Listen to socket reconnection events
    const socket = socketService.connect();
    if (socket) {
      socket.on('connect', () => {
        console.log('[SyncManager] Socket connected, processing offline queue...');
        this.syncOnReconnect();
      });
    }
  }

  async bootstrap(): Promise<void> {
    console.log('[SyncManager] Starting bootstrap sequence...');
    const token = localStorage.getItem('token');
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
      this.processQueue(); // Process any stored queue
      
      console.log('[SyncManager] Bootstrap sequence completed successfully.');
    } catch (error) {
      console.error('[SyncManager] Bootstrap sequence failed:', error);
      // If unauthorized, logout
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

      // 4. Incremental message sync for active room
      const state = store.getState();
      const currentRoom = state.rooms.currentRoom;
      const messages = state.chat.messages;

      if (currentRoom && messages.length > 0) {
        // Find last message with real DB ID (_id)
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
            
            // Add messages to Redux
            decryptedNewMsgs.forEach(msg => {
              store.dispatch(addMessage(msg));
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

  enqueueMessage(msgPayload: Omit<QueuedMessage, 'retryCount'>) {
    const queue = this.getStoredQueue();
    const queuedItem: QueuedMessage = { ...msgPayload, retryCount: 0 };
    queue.push(queuedItem);
    this.saveQueue(queue);

    // Optimistic dispatch
    const optimisticMsg = {
      messageId: queuedItem.clientMsgId,
      clientMsgId: queuedItem.clientMsgId,
      senderId: queuedItem.senderId,
      senderName: queuedItem.senderName,
      roomId: queuedItem.roomId,
      content: queuedItem.isReaction ? '' : queuedItem.content,
      timestamp: new Date().toISOString(),
      type: queuedItem.type,
      mediaFilename: queuedItem.mediaFilename,
      mediaSize: queuedItem.mediaSize,
      replyTo: queuedItem.replyTo,
      isOptimistic: true
    } as any;

    if (queuedItem.isReaction) {
      // Toggle reaction optimistically
      const state = store.getState();
      const targetMsg = state.chat.messages.find(m => m.messageId === queuedItem.clientMsgId || m._id === queuedItem.clientMsgId);
      if (targetMsg) {
        const reactions = targetMsg.reactions || [];
        const index = reactions.findIndex((r: any) => r.userId === queuedItem.senderId && r.emoji === queuedItem.reactionEmoji);
        let updatedReactions = [...reactions];
        if (index !== -1) {
          updatedReactions.splice(index, 1);
        } else {
          updatedReactions.push({ emoji: queuedItem.reactionEmoji!, userId: queuedItem.senderId, createdAt: new Date().toISOString() });
        }
        store.dispatch(updateMessageReactions({ messageId: queuedItem.clientMsgId, reactions: updatedReactions }));
      }
    } else {
      store.dispatch(addMessage(optimisticMsg));
    }

    // Process queue in background
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      let queue = this.getStoredQueue();
      while (queue.length > 0) {
        if (!navigator.onLine || !socketService.connect()?.connected) {
          console.log('[SyncManager] Connection lost, pausing queue processing.');
          break;
        }

        const item = queue[0];
        console.log('[SyncManager] Processing queue item:', item.clientMsgId);

        try {
          if (item.isReaction) {
            socketService.reactToMessage({
              messageId: item.clientMsgId,
              roomId: item.roomId,
              emoji: item.reactionEmoji!
            });
          } else {
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
            });
          }

          // Successfully sent. Remove from queue.
          queue.shift();
          this.saveQueue(queue);
        } catch (err) {
          console.error('[SyncManager] Failed to send queue item:', err);
          item.retryCount++;
          if (item.retryCount > 5) {
            queue.shift();
          } else {
            this.saveQueue(queue);
            const backoff = Math.min(10000, 1000 * Math.pow(2, item.retryCount));
            await new Promise(r => setTimeout(r, backoff));
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private getStoredQueue(): QueuedMessage[] {
    try {
      return JSON.parse(localStorage.getItem('offline_message_queue') || '[]');
    } catch {
      return [];
    }
  }

  private saveQueue(queue: QueuedMessage[]) {
    localStorage.setItem('offline_message_queue', JSON.stringify(queue));
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
