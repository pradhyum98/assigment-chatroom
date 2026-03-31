import React, { useEffect, useState } from 'react';
import Sidebar from '../rooms/Sidebar';
import ChatWindow from './ChatWindow';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { socketService } from '../../services/socket';
import { addMessage } from './chatSlice';
import api from '../../services/api';
import { setRooms } from '../rooms/roomsSlice';
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
      if (currentRoom && message.roomId === currentRoom.roomId) {
        dispatch(addMessage(message));
      }
    };

    socketService.onMessageReceived(handleMessage);

    // This effectively replaces the generic callback with the closure containing currentRoom
    return () => {
       // Note: we can't easily off() yet since socketService doesn't expose it, 
       // but we will update socketService to handle removing listeners.
       socketService.offMessageReceived(handleMessage);
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
