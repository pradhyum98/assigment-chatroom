import React, { useEffect, useState, useRef } from 'react';
import Sidebar from '../rooms/Sidebar';
import ChatWindow from './ChatWindow';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { socketService } from '../../services/socket';
import { 
  addMessage, 
  updateMessage, 
  deleteMessage, 
  updateMessageReactions, 
  updateMessageReceipts, 
  setTyping
} from './chatSlice';
import { updateRoomPreview, updatePresence, setCurrentRoom } from '../rooms/roomsSlice';
import { useCrypto } from '../../hooks/useCrypto';
import { syncManager } from '../../services/syncManager';
import './Chat.css';

const ChatRoom: React.FC = () => {
  const dispatch = useAppDispatch();
  const { currentRoom } = useAppSelector((state) => state.rooms);
  const { user, isAuthenticated } = useAppSelector((state) => state.auth);
   
  const isMobile = () => window.innerWidth <= 768;
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { getRoomKey, decryptPayload } = useCrypto();

  const currentRoomRef = useRef(currentRoom);
  const userRef = useRef(user);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // ── Keyboard/Viewport Handling on Mobile ──────────────────────────────────
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      const chatLayout = document.querySelector('.chat-layout') as HTMLElement;
      if (chatLayout) {
        chatLayout.style.height = `${viewport.height}px`;
      }
    };

    viewport.addEventListener('resize', handleResize);
    viewport.addEventListener('scroll', handleResize);
    handleResize();

    return () => {
      viewport.removeEventListener('resize', handleResize);
      viewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  // ── PWA Lifecycle & Focus Syncing ─────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    syncManager.init();

    const handleSync = () => {
      syncManager.syncOnReconnect();
    };

    window.addEventListener('focus', handleSync);
    window.addEventListener('online', handleSync);
    window.addEventListener('pageshow', handleSync);
    
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleSync);
      window.removeEventListener('online', handleSync);
      window.removeEventListener('pageshow', handleSync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isAuthenticated]);

  // ── Room Navigation Auto-Collapse ────────────────────────────────────────
  useEffect(() => {
    if (currentRoom) {
      socketService.joinRoom(currentRoom.roomId);
      localStorage.setItem('last_active_room_id', currentRoom.roomId);
      if (isMobile()) {
        setIsSidebarOpen(false);
      }
    }
    return () => {
      if (currentRoom) {
        socketService.leaveRoom(currentRoom.roomId);
      }
    };
  }, [currentRoom]);

  // ── Socket Event Listeners and Cleanups ────────────────────────────────────
  useEffect(() => {
    const handleMessage = async (message: any) => {
      let content = message.content;
      if (message.iv && currentRoom && message.roomId === currentRoom.roomId) {
        const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
        if (roomKey) {
          try {
            content = await decryptPayload(message.content, message.iv, roomKey);
          } catch (e) {
            console.error('Failed to decrypt incoming message', e);
            content = '[Decryption Failed]';
          }
        }
      }

      let decryptedMediaUrl = undefined;
      if (message.type !== 'text' && message.mediaUrl && message.mediaKey && message.mediaIv) {
        try {
          const serverUrl = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api$/, '') : 'http://localhost:5001';
          const token = localStorage.getItem('token');
          const fileUrl = message.mediaUrl.startsWith('http') ? message.mediaUrl : `${serverUrl}${message.mediaUrl}?token=${token}`;
          
          const fileRes = await fetch(fileUrl);
          const encryptedBlob = await fileRes.blob();
          const { CryptoService } = await import('../../services/cryptoService');
          decryptedMediaUrl = await CryptoService.decryptFile(
            encryptedBlob,
            message.mediaKey,
            message.mediaIv,
            message.mediaMimeType || 'application/octet-stream'
          );
        } catch (e) {
          console.error('Failed to decrypt incoming media', e);
        }
      }

      // Update room preview and unread counts globally
      dispatch(updateRoomPreview({
        roomId: message.roomId,
        previewText: content,
        unreadIncrementFor: message.roomId !== currentRoom?.roomId && userRef.current?._id 
          ? userRef.current._id 
          : undefined
      }));

      if (currentRoom && message.roomId === currentRoom.roomId) {
        dispatch(addMessage({ ...message, content, decryptedMediaUrl }));
      }
    };

    const handleMessageEdited = async (data: any) => {
      let content = data.content;
      if (data.iv && currentRoom && data.roomId === currentRoom.roomId) {
        const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
        if (roomKey) {
          try {
            content = await decryptPayload(data.content, data.iv, roomKey);
          } catch (e) {
            console.error('Failed to decrypt edited message', e);
            content = '[Decryption Failed]';
          }
        }
      }
      
      dispatch(updateRoomPreview({ roomId: data.roomId, previewText: content }));
      if (currentRoom && data.roomId === currentRoom.roomId) {
        dispatch(updateMessage({ ...data, content }));
      }
    };

    const handleMessageDeleted = (data: any) => {
      if (currentRoom && data.roomId === currentRoom.roomId) {
        dispatch(deleteMessage(data));
      }
    };

    const handleReactionUpdated = (data: any) => {
      dispatch(updateMessageReactions(data));
    };

    const handleMessagesRead = (data: any) => {
      if (currentRoom && data.roomId === currentRoom.roomId) {
        dispatch(updateMessageReceipts({ messageIds: data.messageIds, type: 'read', receipt: { userId: data.userId, readAt: data.readAt } }));
      }
    };

    const handleMessagesDelivered = (data: any) => {
      if (currentRoom && data.roomId === currentRoom.roomId) {
        dispatch(updateMessageReceipts({ messageIds: data.messageIds, type: 'delivered', receipt: { userId: data.userId, deliveredAt: data.deliveredAt } }));
      }
    };

    const handleUserTyping = (data: any) => {
      dispatch(setTyping(data));
    };

    const handlePresenceUpdate = (data: any) => {
      dispatch(updatePresence(data));
    };

    socketService.onMessageReceived(handleMessage);
    socketService.onMessageEdited(handleMessageEdited);
    socketService.onMessageDeleted(handleMessageDeleted);
    socketService.onReactionUpdated(handleReactionUpdated);
    socketService.onMessagesRead(handleMessagesRead);
    socketService.onMessagesDelivered(handleMessagesDelivered);
    socketService.onUserTyping(handleUserTyping);
    socketService.onPresenceUpdate(handlePresenceUpdate);

    return () => {
      socketService.offMessageReceived(handleMessage);
      socketService.offMessageEdited(handleMessageEdited);
      socketService.offMessageDeleted(handleMessageDeleted);
      socketService.offReactionUpdated(handleReactionUpdated);
      socketService.offMessagesRead(handleMessagesRead);
      socketService.offMessagesDelivered(handleMessagesDelivered);
      socketService.offUserTyping(handleUserTyping);
      socketService.offPresenceUpdate(handlePresenceUpdate);
    };
  }, [dispatch, currentRoom]);

  return (
    <div className={`chat-layout ${currentRoom ? 'has-room' : 'no-room'}`}>
      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
      />
      <main className={`chat-main ${!isSidebarOpen ? 'full-width' : ''}`}>
        {currentRoom ? (
          <ChatWindow onBack={() => {
            dispatch(setCurrentRoom(null));
            setIsSidebarOpen(true);
          }} />
        ) : (
          <div className="empty-chat">
            <div className="empty-chat-content fade-in">
              <div className="empty-chat-icon">💬</div>
              <h1>Select a chat room</h1>
              <p>Choose a chat from the sidebar to start messaging.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ChatRoom;
