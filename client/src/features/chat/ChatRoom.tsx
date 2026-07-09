import React, { useEffect, useState } from 'react';
import Sidebar from '../rooms/Sidebar';
import ChatWindow from './ChatWindow';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { socketService } from '../../services/socket';
import { setTyping } from './chatSlice';
import { updatePresence, setCurrentRoom } from '../rooms/roomsSlice';

const ChatRoom: React.FC = () => {
  const dispatch = useAppDispatch();
  const { currentRoom } = useAppSelector((state) => state.rooms);
  const { isAuthenticated } = useAppSelector((state) => state.auth);
   
  const isMobile = () => window.innerWidth <= 768;
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const currentRoomRef = React.useRef(currentRoom);

  React.useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

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
    
    // syncEngine handles reconnect via PlatformLifecycleService and RecoveryCoordinator
    // no need for manual reconnect hooks here anymore.

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
    const handleUserTyping = (data: any) => {
      dispatch(setTyping(data));
    };

    const handlePresenceUpdate = (data: any) => {
      dispatch(updatePresence(data));
    };

    socketService.onUserTyping(handleUserTyping);
    socketService.onPresenceUpdate(handlePresenceUpdate);

    return () => {
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
