import React, { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setCurrentRoom, addRoom } from './roomsSlice';
import type { Room } from './roomsSlice';
import { clearMessages } from '../chat/chatSlice';
import { logout } from '../auth/authSlice';
import api from '../../services/api';
import { Search, Plus, User, LogOut, Users } from 'lucide-react';
import FriendsModal from '../friends/FriendsModal';
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
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const getRoomDisplayName = (room: Room) => {
    if (room.isDM) {
      const otherParticipant = room.participants?.find(
        (p: any) => p._id !== user?._id
      );
      return otherParticipant
        ? `${otherParticipant.firstName} ${otherParticipant.lastName}`
        : 'Direct Message';
    }
    return room.roomName || 'Group Chat';
  };

  const getRoomAvatarChar = (room: Room) => {
    const name = getRoomDisplayName(room);
    return name.charAt(0).toUpperCase();
  };

  const filteredDMs = rooms.filter(
    (room) =>
      room.isDM &&
      getRoomDisplayName(room).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredGroups = rooms.filter(
    (room) =>
      !room.isDM &&
      getRoomDisplayName(room).toLowerCase().includes(searchQuery.toLowerCase())
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
          <div className="sidebar-header-actions" style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowFriendsModal(true)} className="create-room-btn" title="Manage Friends">
              <Users size={18} />
            </button>
            <button onClick={() => setShowCreateModal(true)} className="create-room-btn" title="Create Group">
              <Plus size={20} />
            </button>
          </div>
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

      <div className="room-list-scroll-wrapper" style={{ flex: 1, overflowY: 'auto' }}>
        {/* Direct Messages Section */}
        <div className="sidebar-section-header" style={{ padding: '16px 24px 8px', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Direct Messages
        </div>
        <div className="room-list" style={{ borderTop: 'none', padding: '0' }}>
          {filteredDMs.length > 0 ? (
            filteredDMs.map((room: Room) => (
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
                    {getRoomAvatarChar(room)}
                  </div>
                  {room.isOnline !== false && <div className="status-dot"></div>}
                </div>
                
                <div className="room-info">
                  <div className="room-top">
                    <span className="room-name">{getRoomDisplayName(room)}</span>
                    <span className="room-time">
                      {new Date(room.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="room-bottom">
                    <span className="room-preview">
                      {(room.previewText?.length ?? 0) > 35 
                        ? room.previewText!.substring(0, 35) + '...' 
                        : room.previewText || 'Click to start chatting'}
                    </span>
                    {!!room.unreadCount && room.unreadCount > 0 && (
                      <span className="unread-badge">{room.unreadCount}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ padding: '12px 24px', fontSize: '13px', color: '#94A3B8', fontStyle: 'italic' }}>
              No messages. Click the friend icon to add someone!
            </div>
          )}
        </div>

        {/* Groups Section */}
        <div className="sidebar-section-header" style={{ padding: '16px 24px 8px', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Groups
        </div>
        <div className="room-list" style={{ borderTop: 'none', padding: '0' }}>
          {filteredGroups.length > 0 ? (
            filteredGroups.map((room: Room) => (
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
                    {getRoomAvatarChar(room)}
                  </div>
                </div>
                
                <div className="room-info">
                  <div className="room-top">
                    <span className="room-name">{getRoomDisplayName(room)}</span>
                    <span className="room-time">
                      {new Date(room.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="room-bottom">
                    <span className="room-preview">
                      {(room.previewText?.length ?? 0) > 35 
                        ? room.previewText!.substring(0, 35) + '...' 
                        : room.previewText || 'No messages yet.'}
                    </span>
                    {!!room.unreadCount && room.unreadCount > 0 && (
                      <span className="unread-badge">{room.unreadCount}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ padding: '12px 24px', fontSize: '13px', color: '#94A3B8', fontStyle: 'italic' }}>
              No groups.
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content fade-in">
            <h2>Create Group Room</h2>
            <form onSubmit={handleCreateRoom}>
              <div className="form-group">
                <label>Group Name</label>
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

      {showFriendsModal && (
        <FriendsModal onClose={() => setShowFriendsModal(false)} />
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
