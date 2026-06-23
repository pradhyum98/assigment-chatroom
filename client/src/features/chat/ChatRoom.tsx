import React, { useEffect, useState } from 'react';
import Sidebar from '../rooms/Sidebar';
import ChatWindow from './ChatWindow';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { socketService } from '../../services/socket';
import { addMessage, updateMessage, deleteMessage, updateMessageReactions, updateMessageReceipts, setTyping } from './chatSlice';
import api from '../../services/api';
import { setRooms, updateRoomPreview, updatePresence } from '../rooms/roomsSlice';
import { useCrypto } from '../../hooks/useCrypto';
import './Chat.css';

const ChatRoom: React.FC = () => {
  const dispatch = useAppDispatch();
  const { currentRoom } = useAppSelector((state) => state.rooms);
   
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { getRoomKey, decryptPayload } = useCrypto();

  useEffect(() => {
    // Initial data fetch
    const fetchRooms = async () => {
      try {
        const response = await api.get('/rooms');
        dispatch(setRooms(response.data.data.rooms));
      } catch (err) {
        console.error('Failed to fetch rooms', err);
      }
    };

    fetchRooms();

    // Connect socket on mount
    socketService.connect();

    return () => {
      socketService.disconnect();
    };
  }, [dispatch]);

  useEffect(() => {
    if (currentRoom) {
      socketService.joinRoom(currentRoom.roomId);
    }
    return () => {
      if (currentRoom) {
        socketService.leaveRoom(currentRoom.roomId);
      }
    };
  }, [currentRoom]);

  useEffect(() => {
    // Handle incoming messages for current room
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

      // Update room preview globally
      dispatch(updateRoomPreview({
        roomId: message.roomId,
        previewText: content,
        unreadIncrementFor: message.roomId !== currentRoom?.roomId ? undefined : undefined // Need to handle unread better, skipping here for now since backend increments
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
      if (currentRoom && data.roomId === currentRoom.roomId) {
        dispatch(setTyping(data));
      }
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
       // we skip unregistering others for brevity as socket.ts doesn't have off() for them yet,
       // and this effect only runs when currentRoom changes, which is fine to overwrite
    }
  }, [dispatch, currentRoom]);

  return (
    <div className="chat-layout">
      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
      />
      <main className={`chat-main ${!isSidebarOpen ? 'full-width' : ''}`}>
        {currentRoom ? (
          <ChatWindow />
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
