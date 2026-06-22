import React, { useState, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setMessages, clearTyping } from './chatSlice';
import { clearUnreadCount } from '../rooms/roomsSlice';
import api from '../../services/api';
import { socketService } from '../../services/socket';
import { Send, Mic, Plus, CheckCheck, Check, Loader2, Edit2, Trash2, Smile } from 'lucide-react';
import './Chat.css';

const ChatWindow: React.FC = () => {
  const dispatch = useAppDispatch();
  const { currentRoom } = useAppSelector((state) => state.rooms);
  const { user } = useAppSelector((state) => state.auth);
  const { messages, typingUsers } = useAppSelector((state) => state.chat);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getRoomDisplayName = () => {
    if (!currentRoom) return '';
    if (currentRoom.isDM) {
      const otherParticipant = currentRoom.participants?.find(
        (p: any) => p._id !== user?._id
      );
      return otherParticipant
        ? `${otherParticipant.firstName} ${otherParticipant.lastName}`
        : 'Direct Message';
    }
    return currentRoom.roomName || 'Group Chat';
  };

  const getRoomAvatarChar = () => {
    const name = getRoomDisplayName();
    return name ? name.charAt(0).toUpperCase() : '';
  };

  useEffect(() => {
    const fetchMessages = async () => {
      if (!currentRoom) return;
      setIsLoading(true);
      try {
        const response = await api.get(`/messages/${currentRoom.roomId}`);
        dispatch(setMessages(response.data.data.messages));
        
        // Mark as read if there are messages
        if (response.data.data.messages.length > 0 && user) {
          const unreadMessageIds = response.data.data.messages
            .filter((m: any) => m.senderId !== user._id && !m.readBy?.some((r: any) => r.userId === user._id))
            .map((m: any) => m.messageId || m._id);
            
          if (unreadMessageIds.length > 0) {
            socketService.markAsRead({ roomId: currentRoom.roomId, messageIds: unreadMessageIds });
            dispatch(clearUnreadCount({ roomId: currentRoom.roomId, userId: user._id }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch messages', err);
      } finally {
         setIsLoading(false);
      }
    };

    fetchMessages();
    dispatch(clearTyping());
    setEditingMessageId(null);
  }, [currentRoom, dispatch, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, typingUsers]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    if (currentRoom && !editingMessageId) {
      socketService.setTyping({ roomId: currentRoom.roomId, isTyping: true });
      
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socketService.setTyping({ roomId: currentRoom.roomId, isTyping: false });
      }, 2000);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentRoom || !user) return;

    if (editingMessageId) {
      socketService.editMessage({
        messageId: editingMessageId,
        roomId: currentRoom.roomId,
        content: newMessage.trim()
      });
      setEditingMessageId(null);
      setNewMessage('');
      return;
    }

    const messageData = {
      roomId: currentRoom.roomId,
      senderId: user._id,
      senderName: `${user.firstName} ${user.lastName}`,
      content: newMessage.trim(),
      clientMsgId: Math.random().toString(36).substring(7)
    };

    socketService.sendMessage(messageData);
    setNewMessage('');
    socketService.setTyping({ roomId: currentRoom.roomId, isTyping: false });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  const handleEditClick = (msg: any) => {
    setEditingMessageId(msg.messageId || msg._id);
    setNewMessage(msg.content);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setNewMessage('');
  };

  const handleDelete = (msg: any, forEveryone: boolean) => {
    if (!currentRoom) return;
    socketService.deleteMessage({
      messageId: msg.messageId || msg._id,
      roomId: currentRoom.roomId,
      deleteForEveryone: forEveryone
    });
  };

  const handleReact = (msg: any, emoji: string) => {
    if (!currentRoom) return;
    socketService.reactToMessage({
      messageId: msg.messageId || msg._id,
      roomId: currentRoom.roomId,
      emoji
    });
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

  const activeTypers = Object.values(typingUsers).filter(name => name !== `${user?.firstName} ${user?.lastName}`);

  return (
    <div className="chat-window fade-in">
      <header className="chat-header">
        <div className="chat-user-info">
          <div className="avatar-wrapper">
            <div 
              className="chat-avatar"
              style={currentRoom.avatarColor ? { backgroundColor: currentRoom.avatarColor, color: 'white', border: 'none' } : {}}
            >
              {getRoomAvatarChar()}
            </div>
            {currentRoom.isOnline !== false && <div className="status-dot"></div>}
          </div>
          <div className="chat-user-details">
            <div className="chat-user-name">{getRoomDisplayName()}</div>
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
          const isDeleted = msg.deletedForEveryone;
          
          if (!isSentByMe && msg.deletedAt && !msg.deletedForEveryone) return null; // Soft deleted for other, ignore here since we only soft delete for self in UI usually

          const isRead = msg.readBy && msg.readBy.length > 0;
          const isDelivered = msg.deliveredTo && msg.deliveredTo.length > 0;

          return (
            <div 
              key={msg.messageId || msg._id || idx} 
              className={`message-bubble ${isSentByMe ? 'sent' : 'received'} ${isDeleted ? 'deleted' : ''}`}
            >
              <div className="message-content">
                {isDeleted ? <i>This message was deleted</i> : msg.content}
                {msg.editedAt && !isDeleted && <span className="edited-tag">(edited)</span>}
              </div>
              
              {!isDeleted && (
                <div className="message-actions-overlay">
                  <button onClick={() => handleReact(msg, '👍')} title="React 👍"><Smile size={14} /></button>
                  {isSentByMe && (
                    <>
                      <button onClick={() => handleEditClick(msg)} title="Edit"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(msg, true)} title="Delete for everyone"><Trash2 size={14} color="red" /></button>
                    </>
                  )}
                </div>
              )}

              {msg.reactions && msg.reactions.length > 0 && (
                <div className="reactions-container">
                  {msg.reactions.map((r: any, i: number) => (
                    <span key={i} className="reaction-badge">{r.emoji}</span>
                  ))}
                </div>
              )}

              <div className="message-info">
                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {isSentByMe && (
                  isRead ? <CheckCheck size={14} color="#3b82f6" /> : (isDelivered ? <CheckCheck size={14} /> : <Check size={14} />)
                )}
              </div>
            </div>
          );
        })}
        
        {activeTypers.length > 0 && (
          <div className="typing-indicator">
            {activeTypers.join(', ')} {activeTypers.length === 1 ? 'is' : 'are'} typing...
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <div className="message-input-area">
        {editingMessageId && (
          <div className="editing-banner">
            <span>Editing message...</span>
            <button onClick={cancelEdit} className="cancel-edit-btn">Cancel</button>
          </div>
        )}
        <form onSubmit={handleSendMessage} className="input-container">
          <button type="button" className="action-btn">
            <Plus size={22} />
          </button>
          <input 
            type="text" 
            placeholder="Write your message..." 
            value={newMessage}
            onChange={handleInputChange}
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
