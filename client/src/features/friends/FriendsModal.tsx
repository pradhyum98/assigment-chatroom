import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  setFriends,
  setPendingRequests,
  setSearchResults,
  removeFriendFromState,
} from './friendsSlice';
import { addRoom, setCurrentRoom } from '../rooms/roomsSlice';
import api from '../../services/api';
import { CryptoService } from '../../services/cryptoService';
import { X, Search, Check, Trash2, Send, MessageSquare } from 'lucide-react';
import './Friends.css';

interface FriendsModalProps {
  onClose: () => void;
}

type TabType = 'search' | 'requests' | 'list';

const FriendsModal: React.FC<FriendsModalProps> = ({ onClose }) => {
  const dispatch = useAppDispatch();
  const { friends, pendingRequests, searchResults } = useAppSelector((state) => state.friends);
  const { user: currentUser } = useAppSelector((state) => state.auth);

  const [activeTab, setActiveTab] = useState<TabType>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Debounced search effect
  useEffect(() => {
    if (activeTab !== 'search') return;

    if (!searchQuery.trim()) {
      dispatch(setSearchResults([]));
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      try {
        const response = await api.get(`/friends/search?query=${searchQuery}`);
        dispatch(setSearchResults(response.data.data.users));
      } catch (err) {
        console.error('Failed to search users:', err);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, activeTab, dispatch]);

  // Fetch pending requests & friends list on mount / tab change
  const fetchData = async () => {
    try {
      const [requestsRes, friendsRes] = await Promise.all([
        api.get('/friends/requests'),
        api.get('/friends/list'),
      ]);
      dispatch(setPendingRequests(requestsRes.data.data.requests));
      dispatch(setFriends(friendsRes.data.data.friends));
    } catch (err) {
      console.error('Failed to fetch friends data:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab, dispatch]);

  const handleSendRequest = async (recipientId: string) => {
    setActionLoading(recipientId);
    try {
      await api.post('/friends/request', { recipientId });
      // Remove from search results after request is sent so they don't click it again
      dispatch(setSearchResults(searchResults.filter((u) => u._id !== recipientId)));
      // Refresh pending requests list
      const response = await api.get('/friends/requests');
      dispatch(setPendingRequests(response.data.data.requests));
    } catch (err) {
      console.error('Failed to send friend request:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRespondRequest = async (requestId: string, action: 'accept' | 'reject') => {
    setActionLoading(requestId);
    try {
      await api.post(`/friends/requests/${requestId}/respond`, { action });
      // Refresh list
      await fetchData();
    } catch (err) {
      console.error(`Failed to ${action} request:`, err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    if (!window.confirm('Are you sure you want to remove this friend? This will delete your friendship and DM history.')) {
      return;
    }
    setActionLoading(friendId);
    try {
      await api.post('/friends/remove', { friendId });
      dispatch(removeFriendFromState(friendId));
    } catch (err) {
      console.error('Failed to remove friend:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartDM = async (friendId: string) => {
    setActionLoading(friendId);
    try {
      // Find the friend in the friends array to get their publicKey
      const friend = friends.find(f => f._id === friendId);
      
      // 1. Generate new AES Room Key
      const roomKey = await CryptoService.generateRoomKey();
      const roomKeyBase64 = await CryptoService.exportRoomKey(roomKey);

      // 2. Encrypt for both current user and friend
      const encryptedRoomKeys: Record<string, { encryptedKey: string; identityVersion: number }> = {};
      
      if (currentUser?.publicKey) {
        encryptedRoomKeys[currentUser._id] = {
          encryptedKey: await CryptoService.encryptRoomKeyForUser(roomKeyBase64, currentUser.publicKey),
          identityVersion: (currentUser as any).identityVersion || 1,
        };
      }
      
      if (friend?.publicKey) {
        encryptedRoomKeys[friendId] = {
          encryptedKey: await CryptoService.encryptRoomKeyForUser(roomKeyBase64, friend.publicKey),
          identityVersion: (friend as any).identityVersion || 1,
        };
      } else {
        console.warn('Friend has no public key, they will not be able to decrypt the room messages');
      }

      const response = await api.post(`/rooms/dm/${friendId}`, { encryptedRoomKeys });
      const room = response.data.data.room;
      dispatch(addRoom(room));
      dispatch(setCurrentRoom(room));
      onClose();
    } catch (err) {
      console.error('Failed to start DM:', err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="friends-modal-overlay" onClick={onClose}>
      <div className="friends-modal-content fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="friends-modal-header">
          <h2>Manage Friends</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="friends-tabs">
          <button
            className={`friends-tab-btn ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            Add Friend
          </button>
          <button
            className={`friends-tab-btn ${activeTab === 'requests' ? 'active' : ''}`}
            onClick={() => setActiveTab('requests')}
          >
            Pending Requests ({pendingRequests.length})
          </button>
          <button
            className={`friends-tab-btn ${activeTab === 'list' ? 'active' : ''}`}
            onClick={() => setActiveTab('list')}
          >
            My Friends ({friends.length})
          </button>
        </div>

        <div className="friends-modal-body">
          {activeTab === 'search' && (
            <div>
              <div className="friends-search-input-wrapper">
                <Search className="friends-search-icon" size={18} />
                <input
                  type="text"
                  placeholder="Search users by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="friends-list-wrapper">
                {searchResults.length > 0 ? (
                  searchResults.map((user) => (
                    <div key={user._id} className="friend-item-row">
                      <div className="friend-item-info">
                        <span className="friend-item-name">
                          {user.firstName} {user.lastName}
                        </span>
                        <span className="friend-item-email">{user.email}</span>
                      </div>
                      <button
                        className="friend-action-btn send-req"
                        onClick={() => handleSendRequest(user._id)}
                        disabled={actionLoading === user._id}
                      >
                        <Send size={14} />
                        {actionLoading === user._id ? 'Sending...' : 'Add Friend'}
                      </button>
                    </div>
                  ))
                ) : searchQuery.trim() ? (
                  <div className="friends-empty-state">No users found matching your search.</div>
                ) : (
                  <div className="friends-empty-state">
                    <div className="friends-empty-state-icon">🔍</div>
                    <p>Type a name or email address to search for friends.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="friends-list-wrapper">
              {pendingRequests.length > 0 ? (
                pendingRequests.map((req) => {
                  const isIncoming = req.recipient._id === currentUser?._id;
                  const otherUser = isIncoming ? req.sender : req.recipient;

                  return (
                    <div key={req._id} className="friend-item-row">
                      <div className="friend-item-info">
                        <span className="friend-item-name">
                          {otherUser.firstName} {otherUser.lastName}
                        </span>
                        <span className="friend-item-email">{otherUser.email}</span>
                        <span className="friend-item-email" style={{ fontStyle: 'italic', marginTop: '2px' }}>
                          {isIncoming ? 'Incoming Request' : 'Outgoing Request (Pending)'}
                        </span>
                      </div>

                      {isIncoming ? (
                        <div className="request-actions-group">
                          <button
                            className="friend-action-btn accept"
                            onClick={() => handleRespondRequest(req._id, 'accept')}
                            disabled={actionLoading === req._id}
                          >
                            <Check size={14} /> Accept
                          </button>
                          <button
                            className="friend-action-btn reject"
                            onClick={() => handleRespondRequest(req._id, 'reject')}
                            disabled={actionLoading === req._id}
                          >
                            <X size={14} /> Decline
                          </button>
                        </div>
                      ) : (
                        <button className="friend-action-btn reject" style={{ backgroundColor: '#94A3B8' }} disabled>
                          Pending
                        </button>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="friends-empty-state">
                  <div className="friends-empty-state-icon">✉️</div>
                  <p>No pending friend requests.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'list' && (
            <div className="friends-list-wrapper">
              {friends.length > 0 ? (
                friends.map((friend) => (
                  <div key={friend._id} className="friend-item-row">
                    <div className="friend-item-info">
                      <span className="friend-item-name">
                        {friend.firstName} {friend.lastName}
                      </span>
                      <span className="friend-item-email">{friend.email}</span>
                    </div>
                    <div className="request-actions-group">
                      <button
                        className="friend-action-btn accept"
                        onClick={() => handleStartDM(friend._id)}
                        disabled={actionLoading === friend._id}
                      >
                        <MessageSquare size={14} /> Message
                      </button>
                      <button
                        className="friend-action-btn reject"
                        onClick={() => handleRemoveFriend(friend._id)}
                        disabled={actionLoading === friend._id}
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="friends-empty-state">
                  <div className="friends-empty-state-icon">👥</div>
                  <p>You haven't added any friends yet.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FriendsModal;
