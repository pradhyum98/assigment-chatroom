import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setCurrentRoom, addRoom } from './roomsSlice';
import type { Room } from './roomsSlice';
import { clearMessages } from '../chat/chatSlice';
import { logout } from '../auth/authSlice';
import api from '../../services/api';
import { CryptoService } from '../../services/cryptoService';
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
  const { typingUsers } = useAppSelector((state) => state.chat);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [friendsList, setFriendsList] = useState<any[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  
  // Fetch friends when create modal opens
  useEffect(() => {
    if (showCreateModal) {
      api.get('/friends/list').then(res => {
        setFriendsList(res.data.data.friends || []);
      }).catch(err => {
        console.error('Failed to fetch friends for group creation', err);
      });
    } else {
      setNewRoomName('');
      setSelectedFriends([]);
    }
  }, [showCreateModal]);

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

  const [decryptedPreviews, setDecryptedPreviews] = useState<Record<string, string>>({});

  const getRoomKey = async (roomId: string, encryptedRoomKeys: any) => {
    try {
      const savedKey = localStorage.getItem(`room_key_${roomId}`);
      if (savedKey) {
        return await CryptoService.importRoomKey(savedKey);
      }
      const privKeyBase64 = localStorage.getItem('e2e_private_key');
      if (privKeyBase64 && encryptedRoomKeys) {
        const myEncKey = encryptedRoomKeys[user?._id || ''];
        if (myEncKey) {
          const privKey = await CryptoService.importPrivateKey(privKeyBase64);
          const roomKeyStr = await CryptoService.decryptRoomKey(myEncKey, privKey);
          localStorage.setItem(`room_key_${roomId}`, roomKeyStr);
          return await CryptoService.importRoomKey(roomKeyStr);
        }
      }
    } catch (e) {
      console.error('Failed to decrypt room key in sidebar', e);
    }
    return null;
  };

  useEffect(() => {
    const decryptAllPreviews = async () => {
      const newPreviews = { ...decryptedPreviews };
      let changed = false;

      for (const room of rooms) {
        // Typing indicator check
        const typers = typingUsers[room.roomId] || {};
        const activeTypers = Object.values(typers).filter(name => name !== `${user?.firstName} ${user?.lastName}`);
        if (activeTypers.length > 0) {
          const text = `${activeTypers[0]} is typing...`;
          if (newPreviews[room.roomId] !== text) {
            newPreviews[room.roomId] = text;
            changed = true;
          }
          continue;
        }

        if (newPreviews[room.roomId] && newPreviews[room.roomId].endsWith('is typing...')) {
          delete newPreviews[room.roomId];
          changed = true;
        }

        if (newPreviews[room.roomId]) continue;

        changed = true;
        if (room.lastMessage) {
          const msg = room.lastMessage;
          if (msg.type && msg.type !== 'text') {
            let label = '📄 Document';
            if (msg.type === 'image') label = '📷 Photo';
            else if (msg.type === 'video') label = '🎥 Video';
            else if (msg.type === 'audio' || msg.type === 'voice') label = '🎤 Voice Message';
            newPreviews[room.roomId] = label;
            continue;
          }

          if (msg.content) {
            if (msg.iv) {
              const roomKey = await getRoomKey(room.roomId, room.encryptedRoomKeys);
              if (roomKey) {
                try {
                  const decrypted = await CryptoService.decryptMessage(msg.content, msg.iv, roomKey);
                  newPreviews[room.roomId] = decrypted;
                } catch {
                  newPreviews[room.roomId] = '🔒 Encrypted Message';
                }
              } else {
                newPreviews[room.roomId] = '🔒 Encrypted Message';
              }
            } else {
              newPreviews[room.roomId] = msg.content;
            }
          }
        } else {
          let fallback = room.previewText || 'Click to start chatting';
          if (fallback.includes('[Attachment:')) {
            if (fallback.includes('image')) fallback = '📷 Photo';
            else if (fallback.includes('video')) fallback = '🎥 Video';
            else if (fallback.includes('audio')) fallback = '🎤 Voice Message';
            else fallback = '📄 Document';
          } else if (fallback !== 'Click to start chatting' && fallback !== 'No messages yet.') {
            fallback = '🔒 Encrypted Message';
          }
          newPreviews[room.roomId] = fallback;
        }
      }

      if (changed) {
        setDecryptedPreviews(newPreviews);
      }
    };

    decryptAllPreviews();
  }, [rooms, typingUsers]);

  const isRoomOnline = (room: Room) => {
    if (room.isOnline !== undefined) return room.isOnline;
    if (room.isDM) {
      const otherParticipant = room.participants?.find(
        (p: any) => p._id !== user?._id
      );
      return otherParticipant?.isOnline || false;
    }
    return false;
  };

  const hiddenRooms = JSON.parse(localStorage.getItem('hidden_rooms') || '[]');
  const visibleRooms = rooms.filter(room => !hiddenRooms.includes(room.roomId));

  const filteredDMs = visibleRooms.filter(
    (room) =>
      room.isDM &&
      getRoomDisplayName(room).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredGroups = visibleRooms.filter(
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
      // 1. Generate new AES Room Key
      const roomKey = await CryptoService.generateRoomKey();
      const roomKeyBase64 = await CryptoService.exportRoomKey(roomKey);

      // 2. Map of userId -> encrypted room key
      const encryptedRoomKeys: Record<string, string> = {};

      // Ensure current user is in participants list for encryption
      const allParticipants = [user?._id, ...selectedFriends].filter(Boolean) as string[];

      // Build a map of public keys from our friendsList, plus current user
      const pubKeyMap: Record<string, string> = {};
      if (user?._id && user?.publicKey) pubKeyMap[user._id] = user.publicKey;
      
      friendsList.forEach(f => {
        if (f.publicKey) {
          pubKeyMap[f._id] = f.publicKey;
        }
      });

      // 3. Encrypt room key for each participant
      for (const pId of allParticipants) {
        const pubKey = pubKeyMap[pId];
        if (pubKey) {
          encryptedRoomKeys[pId] = await CryptoService.encryptRoomKeyForUser(roomKeyBase64, pubKey);
        } else {
          console.warn(`No public key for participant ${pId}, they won't be able to decrypt messages.`);
        }
      }

      const response = await api.post('/rooms', { 
        roomName: newRoomName,
        participants: selectedFriends,
        encryptedRoomKeys
      });
      const createdRoom = response.data.data.room;
      dispatch(addRoom(createdRoom));
      dispatch(setCurrentRoom(createdRoom));
      setNewRoomName('');
      setSelectedFriends([]);
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
            filteredDMs.map((room: Room) => {
              const unreadCount = room.unreadCounts?.[user?._id || ''] || 0;
              return (
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
                    {isRoomOnline(room) && <div className="status-dot"></div>}
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
                        {decryptedPreviews[room.roomId] 
                          ? (decryptedPreviews[room.roomId].length > 35 
                              ? decryptedPreviews[room.roomId].substring(0, 35) + '...' 
                              : decryptedPreviews[room.roomId])
                          : 'Click to start chatting'}
                      </span>
                      {unreadCount > 0 && (
                        <span className="unread-badge">{unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
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
            filteredGroups.map((room: Room) => {
              const unreadCount = room.unreadCounts?.[user?._id || ''] || 0;
              return (
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
                        {decryptedPreviews[room.roomId] 
                          ? (decryptedPreviews[room.roomId].length > 35 
                              ? decryptedPreviews[room.roomId].substring(0, 35) + '...' 
                              : decryptedPreviews[room.roomId])
                          : 'No messages yet.'}
                      </span>
                      {unreadCount > 0 && (
                        <span className="unread-badge">{unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
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
              <div className="form-group" style={{ marginTop: '16px' }}>
                <label>Select Participants</label>
                <div className="friends-selection-list" style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', marginTop: '8px' }}>
                  {friendsList.length > 0 ? (
                    friendsList.map(friend => (
                      <div key={friend._id} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                        <input
                          type="checkbox"
                          id={`friend-${friend._id}`}
                          value={friend._id}
                          checked={selectedFriends.includes(friend._id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedFriends([...selectedFriends, friend._id]);
                            } else {
                              setSelectedFriends(selectedFriends.filter(id => id !== friend._id));
                            }
                          }}
                          style={{ marginRight: '8px' }}
                        />
                        <label htmlFor={`friend-${friend._id}`} style={{ margin: 0, cursor: 'pointer', fontSize: '14px' }}>
                          {friend.firstName} {friend.lastName}
                        </label>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: '13px', color: '#94A3B8', padding: '4px' }}>No friends available to add.</div>
                  )}
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: '24px' }}>
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
