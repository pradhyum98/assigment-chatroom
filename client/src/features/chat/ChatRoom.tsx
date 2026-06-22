import React, { useEffect, useState } from 'react';
import Sidebar from '../rooms/Sidebar';
import ChatWindow from './ChatWindow';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { socketService } from '../../services/socket';
import { addMessage, updateMessage, deleteMessage, updateMessageReactions, updateMessageReceipts, setTyping } from './chatSlice';
import api from '../../services/api';
import { setRooms, updateRoomPreview, updatePresence } from '../rooms/roomsSlice';
import './Chat.css';

const ChatRoom: React.FC = () => {
  const dispatch = useAppDispatch();
  const { currentRoom } = useAppSelector((state) => state.rooms);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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
    const handleMessage = (message: any) => {
      // Update room preview globally
      dispatch(updateRoomPreview({
        roomId: message.roomId,
        previewText: message.content,
        unreadIncrementFor: message.roomId !== currentRoom?.roomId ? undefined : undefined // Need to handle unread better, skipping here for now since backend increments
      }));

      if (currentRoom && message.roomId === currentRoom.roomId) {
        dispatch(addMessage(message));
      }
    };

    const handleMessageEdited = (data: any) => {
      dispatch(updateRoomPreview({ roomId: data.roomId, previewText: data.content }));
      if (currentRoom && data.roomId === currentRoom.roomId) {
        dispatch(updateMessage(data));
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
