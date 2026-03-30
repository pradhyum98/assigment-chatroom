import React, { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setCurrentRoom, addRoom } from './roomsSlice';
import type { Room } from './roomsSlice';
import { clearMessages } from '../chat/chatSlice';
import { logout } from '../auth/authSlice';
import api from '../../services/api';
import { Search, Plus, User, LogOut } from 'lucide-react';
import './Sidebar.css';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen }) => {
  const dispatch = useAppDispatch();
  const { rooms, currentRoom } = useAppSelector((state) => state.rooms);
  const { user } = useAppSelector((state) => state.auth);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const filteredRooms = rooms.filter(room => 
    room.roomName.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const handleRoomSelect = (room: Room) => {
    if (currentRoom?.roomId === room.roomId) return;
    dispatch(clearMessages());
    dispatch(setCurrentRoom(room));
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim() || isCreating) return;
    setIsCreating(true);

    try {
      const response = await api.post('/rooms', { roomName: newRoomName });
      const createdRoom = response.data.data.room;
      dispatch(addRoom(createdRoom));
      dispatch(setCurrentRoom(createdRoom));
      setNewRoomName('');
      setShowCreateModal(false);
    } catch (err) {
      console.error('Failed to create room', err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <aside className={`sidebar ${!isOpen ? 'closed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-title">
          <h1>My Chats</h1>
          <button onClick={() => setShowCreateModal(true)} className="create-room-btn">
            <Plus size={20} />
          </button>
        </div>
        <div className="search-container">
          <Search className="search-icon" size={18} />
          <input 
            type="text" 
            placeholder="Search..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="room-list">
        {filteredRooms.map((room: Room) => (
          <div 
            key={room.roomId} 
            className={`room-item ${currentRoom?.roomId === room.roomId ? 'active' : ''}`}
            onClick={() => handleRoomSelect(room)}
          >
            <div className="avatar-wrapper">
              <div 
                className="room-avatar" 
                style={room.avatarColor ? { backgroundColor: room.avatarColor } : {}}
              >
                {room.roomName.charAt(0).toUpperCase()}
              </div>
              {room.isOnline !== false && <div className="status-dot"></div>}
            </div>
            
            <div className="room-info">
              <div className="room-top">
                <span className="room-name">{room.roomName}</span>
                <span className="room-time">
                  {new Date(room.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="room-bottom">
                <span className="room-preview">
                  {(room.previewText?.length ?? 0) > 35 
                    ? room.previewText!.substring(0, 35) + '...' 
                    : room.previewText || 'Click to join this conversation'}
                </span>
                {!!room.unreadCount && room.unreadCount > 0 && (
                  <span className="unread-badge">{room.unreadCount}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content fade-in">
            <h2>Create Chatroom</h2>
            <form onSubmit={handleCreateRoom}>
              <div className="form-group">
                <label>Room Name</label>
                <input 
                  type="text" 
                  value={newRoomName} 
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="e.g. Project Alpha"
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary" disabled={isCreating}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isCreating}>
                  {isCreating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <div className="user-profile">
          <div className="user-avatar">
            <User size={20} />
          </div>
          <div className="user-info">
            <span className="user-name">{user?.firstName} {user?.lastName}</span>
            <span className="user-email">{user?.email}</span>
          </div>
          <button 
            className="action-btn logout-btn" 
            onClick={() => dispatch(logout())}
            title="Log Out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
