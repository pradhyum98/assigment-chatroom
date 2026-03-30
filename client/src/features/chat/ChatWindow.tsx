import React, { useState, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setMessages, addMessage } from './chatSlice';
import api from '../../services/api';
import { socketService } from '../../services/socket';
import { Send, Mic, Plus, CheckCheck, Loader2 } from 'lucide-react';
import './Chat.css';

const ChatWindow: React.FC = () => {
  const dispatch = useAppDispatch();
  const { currentRoom } = useAppSelector((state) => state.rooms);
  const { user } = useAppSelector((state) => state.auth);
  const { messages } = useAppSelector((state) => state.chat);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchMessages = async () => {
      if (!currentRoom) return;
      setIsLoading(true);
      try {
        const response = await api.get(`/messages/${currentRoom.roomId}`);
        dispatch(setMessages(response.data.data.messages));
      } catch (err) {
        console.error('Failed to fetch messages', err);
      } finally {
         setIsLoading(false);
      }
    };

    fetchMessages();
  }, [currentRoom, dispatch, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages]);

  // Handle real-time messages
  useEffect(() => {
    if (!currentRoom) return;

    // Join the room on the socket server
    socketService.connect();
    socketService.joinRoom(currentRoom.roomId);

    const handleMessage = (message: any) => {
      // Only add if it belongs to the current room
      if (message.roomId === currentRoom.roomId) {
        dispatch(addMessage(message));
      }
    };

    socketService.onMessageReceived(handleMessage);

    return () => {
      socketService.offMessageReceived(handleMessage);
      socketService.leaveRoom(currentRoom.roomId);
    };
  }, [currentRoom, dispatch]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentRoom || !user) return;

    const messageData = {
      roomId: currentRoom.roomId,
      senderId: user._id,
      senderName: `${user.firstName} ${user.lastName}`,
      content: newMessage.trim()
    };

    socketService.sendMessage(messageData);
    setNewMessage('');
  };

  if (!currentRoom) return (
    <div className="empty-chat">
      <div className="empty-chat-content fade-in">
        <div className="empty-chat-icon">
          <Send size={48} />
        </div>
        <h1>Welcome to Real-Time Chat</h1>
        <p>Select a room from the sidebar to start a conversation with your team.</p>
      </div>
    </div>
  );

  return (
    <div className="chat-window fade-in">
      <header className="chat-header">
        <div className="chat-user-info">
          <div className="avatar-wrapper">
            <div 
              className="chat-avatar"
              style={currentRoom.avatarColor ? { backgroundColor: currentRoom.avatarColor, color: 'white', border: 'none' } : {}}
            >
              {currentRoom.roomName.charAt(0).toUpperCase()}
            </div>
            {currentRoom.isOnline !== false && <div className="status-dot"></div>}
          </div>
          <div className="chat-user-details">
            <div className="chat-user-name">{currentRoom.roomName}</div>
            <div className={`chat-status ${currentRoom.isOnline === false ? 'offline' : ''}`}>
              {currentRoom.isOnline !== false ? 'Online' : 'Offline'}
            </div>
          </div>
        </div>
        <div className="header-actions">
          <button className="action-btn"><Mic size={20} /></button>
        </div>
      </header>

      <div className="messages-area">
        {isLoading && (
          <div className="loading-indicator">
            <Loader2 className="loading-spinner" />
          </div>
        )}
        
        <div className="date-separator">
          <span>Today</span>
        </div>
        
        {messages.map((msg: any, idx: number) => {
          const isSentByMe = msg.senderId === user?._id;
          return (
            <div 
              key={msg.messageId || idx} 
              className={`message-bubble ${isSentByMe ? 'sent' : 'received'}`}
            >
              <div className="message-content">{msg.content}</div>
              <div className="message-info">
                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {isSentByMe && <CheckCheck size={14} />}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="message-input-area">
        <form onSubmit={handleSendMessage} className="input-container">
          <button type="button" className="action-btn">
            <Plus size={22} />
          </button>
          <input 
            type="text" 
            placeholder="Write your message..." 
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
          />
          <div className="input-actions">
            <button type="button" className="action-btn"><Mic size={20} /></button>
            <button type="submit" className="send-btn" disabled={!newMessage.trim()}>
              <Send size={18} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatWindow;
