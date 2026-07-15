import React, { useState, useEffect, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setCurrentRoom, addRoom } from './roomsSlice';
import type { Room } from './roomsSlice';
import { clearMessages } from '../chat/chatSlice';
import { logoutUser } from '../auth/authSlice';
import { AppLockSettings } from '../settings/AppLockSettings';
import {
  setFriends,
  setPendingRequests,
  setSearchResults,
  removeFriendFromState,
} from '../friends/friendsSlice';
import api from '../../services/api';
import { CryptoService } from '../../services/cryptoService';
import { syncEngine } from '../../services/SyncEngine';
import {
  Search,
  Plus,
  User,
  LogOut,
  Users,
  MessageSquare,
  Phone,
  Settings,
  ChevronRight,
  Check,
  X,
  Trash2,
  Send,
  ArrowLeft,
  Bell,
  Shield,
  Database,
  Palette,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
} from 'lucide-react';
import './Sidebar.css';

// ─── Types ────────────────────────────────────────────────────────────────────
type NavTab = 'chats' | 'calls' | 'people' | 'settings';
type ChatFilter = 'all' | 'unread' | 'groups' | 'pinned';
type PeopleTab = 'list' | 'search' | 'requests';
type SettingsPanel = null | 'theme' | 'profile' | 'notifications' | 'privacy' | 'storage';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Mock call history (local-only, no backend) ───────────────────────────────
const MOCK_CALLS = [
  { id: '1', name: 'Alice Johnson', type: 'incoming', time: '2m ago', missed: false },
  { id: '2', name: 'Bob Smith', type: 'outgoing', time: '1h ago', missed: false },
  { id: '3', name: 'Carol White', type: 'missed', time: 'Yesterday', missed: true },
  { id: '4', name: 'David Lee', type: 'incoming', time: 'Yesterday', missed: false },
];

// ─── Theme definitions ────────────────────────────────────────────────────────
const THEMES = [
  { id: 'theme-dark', label: 'Dark', emoji: '🌙' },
  { id: 'theme-amoled', label: 'AMOLED', emoji: '⬛' },
  { id: 'theme-light', label: 'Light', emoji: '☀️' },
  { id: 'theme-ocean', label: 'Ocean', emoji: '🌊' },
  { id: 'theme-forest', label: 'Forest', emoji: '🌿' },
  { id: 'theme-lavender', label: 'Lavender', emoji: '💜' },
  { id: 'theme-nord', label: 'Nord', emoji: '❄️' },
  { id: 'theme-material', label: 'Material You', emoji: '🎨' },
];

// ─── Component ─────────────────────────────────────────────────────────────────
const Sidebar: React.FC<SidebarProps> = ({ isOpen }) => {
  const dispatch = useAppDispatch();
  const { rooms, currentRoom } = useAppSelector((state) => state.rooms);
  const { user } = useAppSelector((state) => state.auth);
  const { typingUsers } = useAppSelector((state) => state.chat);
  const { friends, pendingRequests, searchResults } = useAppSelector((state) => state.friends);

  // ── Nav state ──
  const [activeTab, setActiveTab] = useState<NavTab>('chats');
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [peopleTab, setPeopleTab] = useState<PeopleTab>('list');
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>(null);

  // ── Chats state ──
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [friendsList, setFriendsList] = useState<any[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [decryptedPreviews, setDecryptedPreviews] = useState<Record<string, string>>({});

  // ── People state ──
  const [peopleSearch, setPeopleSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Theme state ──
  const [activeTheme, setActiveTheme] = useState<string>(() => {
    return localStorage.getItem('app_theme') || 'theme-dark';
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // REST API fallback: if IDB/recovery didn't populate rooms (e.g. after fresh
  // install / reinstall where app data is wiped), fetch directly from the server.
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    if (rooms.length > 0) return; // Already populated via IDB/recovery

    const loadRoomsFromApi = async () => {
      try {
        const res = await api.get('/rooms');
        const apiRooms: any[] = res.data.data?.rooms || res.data.rooms || [];
        if (apiRooms.length > 0) {
          const { setRooms: setRoomsAction } = await import('./roomsSlice');
          dispatch(setRoomsAction(apiRooms));
        }
      } catch (e) {
        console.warn('[Sidebar] REST API rooms fallback failed:', e);
      }
    };

    // Give IDB/recovery 3 seconds to populate rooms before hitting REST API
    const timer = setTimeout(loadRoomsFromApi, 3000);
    return () => clearTimeout(timer);
  }, [user, rooms.length, dispatch]);


  const getRoomKey = async (roomId: string, encryptedRoomKeys: any) => {
    try {
      const { secretStore } = await import('../../services/secretStore');
      const rawKey = encryptedRoomKeys ? encryptedRoomKeys[user?._id || ''] : undefined;
      const encryptedKeyForMe = rawKey && typeof rawKey === 'object' ? rawKey.encryptedKey : rawKey;
      return await secretStore.getOrUnwrapRoomKey(roomId, encryptedKeyForMe);
    } catch (e) {
      console.error('Failed to decrypt room key in sidebar', e);
      return null;
    }
  };

  useEffect(() => {
    const decryptAllPreviews = async () => {
      const newPreviews = { ...decryptedPreviews };
      let changed = false;

      for (const room of rooms) {
        const typers = typingUsers[room.roomId] || {};
        const activeTypers = Object.values(typers).filter(
          (name) => name !== `${user?.firstName} ${user?.lastName}`
        );
        if (activeTypers.length > 0) {
          const text = `${activeTypers[0]} is typing...`;
          if (newPreviews[room.roomId] !== text) {
            newPreviews[room.roomId] = text;
            changed = true;
          }
          continue;
        }

        if (newPreviews[room.roomId]?.endsWith('is typing...')) {
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

      if (changed) setDecryptedPreviews(newPreviews);
    };

    decryptAllPreviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, typingUsers]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Room helpers (preserved exactly)
  // ─────────────────────────────────────────────────────────────────────────────
  const getRoomDisplayName = (room: Room) => {
    if (room.isDM) {
      const otherRaw = room.participants?.find((p: any) => (typeof p === 'string' ? p : p._id) !== user?._id);
      const otherId = typeof otherRaw === 'string' ? otherRaw : otherRaw?._id;
      const other = otherId ? (friends.find((f: any) => f._id === otherId) || (typeof otherRaw === 'object' ? otherRaw : null)) : null;
      return other ? `${other.firstName} ${other.lastName}` : 'Direct Message';
    }
    return room.roomName || 'Group Chat';
  };

  const getRoomAvatarChar = (room: Room) => getRoomDisplayName(room).charAt(0).toUpperCase();

  const isRoomOnline = (room: Room) => {
    if (room.isOnline !== undefined) return room.isOnline;
    if (room.isDM) {
      const otherRaw = room.participants?.find((p: any) => (typeof p === 'string' ? p : p._id) !== user?._id);
      const otherId = typeof otherRaw === 'string' ? otherRaw : otherRaw?._id;
      const other = otherId ? (friends.find((f: any) => f._id === otherId) || (typeof otherRaw === 'object' ? otherRaw : null)) : null;
      return other?.isOnline || false;
    }
    return false;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Filtered rooms
  // ─────────────────────────────────────────────────────────────────────────────
  const hiddenRooms: string[] = JSON.parse(localStorage.getItem('hidden_rooms') || '[]');
  const visibleRooms = rooms.filter((r) => !hiddenRooms.includes(r.roomId));
  const pinnedRooms: string[] = JSON.parse(localStorage.getItem('pinned_rooms') || '[]');

  const filteredRooms = visibleRooms.filter((room) => {
    const name = getRoomDisplayName(room).toLowerCase();
    const matchesSearch = name.includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (chatFilter === 'unread') return (room.unreadCounts?.[user?._id || ''] || 0) > 0;
    if (chatFilter === 'groups') return !room.isDM;
    if (chatFilter === 'pinned') return pinnedRooms.includes(room.roomId);
    return true;
  });

  const filteredDMs = filteredRooms.filter((r) => r.isDM);
  const filteredGroups = filteredRooms.filter((r) => !r.isDM);

  // ─────────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────────
  const handleRoomSelect = (room: Room) => {
    if (currentRoom?.roomId === room.roomId) return;
    dispatch(clearMessages());
    dispatch(setCurrentRoom(room));
  };

  useEffect(() => {
    if (showCreateModal) {
      api.get('/friends/list').then((res) => {
        setFriendsList(res.data.data.friends || []);
      }).catch((err) => console.error('Failed to fetch friends for group creation', err));
    } else {
      setNewRoomName('');
      setSelectedFriends([]);
    }
  }, [showCreateModal]);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const roomKey = await CryptoService.generateRoomKey();
      const roomKeyBase64 = await CryptoService.exportRoomKey(roomKey);
      const encryptedRoomKeys: Record<string, { encryptedKey: string; identityVersion: number }> = {};
      const allParticipants = [user?._id, ...selectedFriends].filter(Boolean) as string[];
      const pubKeyMap: Record<string, string> = {};
      if (user?._id && user?.publicKey) pubKeyMap[user._id] = user.publicKey;
      friendsList.forEach((f) => { if (f.publicKey) pubKeyMap[f._id] = f.publicKey; });
      for (const pId of allParticipants) {
        const pubKey = pubKeyMap[pId];
        const participant = pId === user?._id ? user : friendsList.find((f) => f._id === pId);
        if (pubKey) {
          encryptedRoomKeys[pId] = {
            encryptedKey: await CryptoService.encryptRoomKeyForUser(roomKeyBase64, pubKey),
            identityVersion: participant?.identityVersion || 1,
          };
        }
      }
      const response = await api.post('/rooms', { roomName: newRoomName, participants: selectedFriends, encryptedRoomKeys });
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

  // ─── Theme ─────────────────────────────────────────────────────────────────
  const applyTheme = (themeId: string) => {
    const root = document.documentElement;
    THEMES.forEach((t) => root.classList.remove(t.id));
    root.classList.add(themeId);
    localStorage.setItem('app_theme', themeId);
    setActiveTheme(themeId);
  };

  // ─── People / Friends actions ──────────────────────────────────────────────
  const fetchFriendsData = useCallback(async () => {
    try {
      const [reqRes, frRes] = await Promise.all([
        api.get('/friends/requests'),
        api.get('/friends/list'),
      ]);
      dispatch(setPendingRequests(reqRes.data.data.requests));
      dispatch(setFriends(frRes.data.data.friends));
    } catch (err) {
      console.error('Failed to fetch friends data:', err);
    }
  }, [dispatch]);

  useEffect(() => {
    fetchFriendsData();
  }, [fetchFriendsData]);

  useEffect(() => {
    if (activeTab === 'people') fetchFriendsData();
  }, [activeTab, peopleTab, fetchFriendsData]);

  // Debounced user search
  useEffect(() => {
    if (peopleTab !== 'search') return;
    if (!peopleSearch.trim()) { dispatch(setSearchResults([])); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/friends/search?query=${peopleSearch}`);
        dispatch(setSearchResults(res.data.data.users));
      } catch (err) { console.error('Search failed', err); }
    }, 300);
    return () => clearTimeout(timer);
  }, [peopleSearch, peopleTab, dispatch]);

  const handleSendRequest = async (recipientId: string) => {
    setActionLoading(recipientId);
    try {
      await api.post('/friends/request', { recipientId });
      dispatch(setSearchResults(searchResults.filter((u) => u._id !== recipientId)));
      const res = await api.get('/friends/requests');
      dispatch(setPendingRequests(res.data.data.requests));
      alert('Friend request sent successfully.');
    } catch (err: any) {
      console.error('Failed to send friend request:', err);
      const errMsg = err.response?.data?.message || err.message || 'Unknown error';
      alert(`Failed to send friend request: ${errMsg}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRespondRequest = async (requestId: string, action: 'accept' | 'reject') => {
    setActionLoading(requestId);
    try {
      await api.post(`/friends/requests/${requestId}/respond`, { action });
      await fetchFriendsData();
      alert(`Friend request ${action}ed successfully.`);
    } catch (err: any) {
      console.error(`Failed to ${action} request:`, err);
      const errMsg = err.response?.data?.message || err.message || 'Unknown error';
      alert(`Failed to ${action} request: ${errMsg}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    if (!window.confirm('Remove this friend? This will also delete your DM history.')) return;
    setActionLoading(friendId);
    try {
      await api.post('/friends/remove', { friendId });
      dispatch(removeFriendFromState(friendId));
      alert('Friend removed successfully.');
    } catch (err: any) {
      console.error('Failed to remove friend:', err);
      const errMsg = err.response?.data?.message || err.message || 'Unknown error';
      alert(`Failed to remove friend: ${errMsg}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartDM = async (friendId: string) => {
    setActionLoading(friendId);
    try {
      const friend = friends.find((f) => f._id === friendId);

      // Build encryptedRoomKeys in the format the server schema expects:
      // Record<userId, { encryptedKey: string; identityVersion: number }>
      const encryptedRoomKeys: Record<string, { encryptedKey: string; identityVersion: number }> = {};

      if (user?.publicKey && friend?.publicKey) {
        // Both users have public keys — perform E2EE key setup
        const roomKey = await CryptoService.generateRoomKey();
        const roomKeyBase64 = await CryptoService.exportRoomKey(roomKey);
        encryptedRoomKeys[user._id] = {
          encryptedKey: await CryptoService.encryptRoomKeyForUser(roomKeyBase64, user.publicKey),
          identityVersion: 1,
        };
        encryptedRoomKeys[friendId] = {
          encryptedKey: await CryptoService.encryptRoomKeyForUser(roomKeyBase64, friend.publicKey),
          identityVersion: 1,
        };
      }
      // If either user lacks a public key, send empty keys — server allows {} default.

      const response = await api.post(`/rooms/dm/${friendId}`, { encryptedRoomKeys });
      const room = response.data.data.room;
      dispatch(addRoom(room));
      dispatch(setCurrentRoom(room));
      setActiveTab('chats');
    } catch (err: any) {
      console.error('Failed to start DM:', err);
      const errMsg = err.response?.data?.message || err.message || 'Unknown error';
      alert(`Failed to start DM: ${errMsg}`);
    } finally {
      setActionLoading(null);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────────
  const renderRoomItem = (room: Room) => {
    const unreadCount = room.unreadCounts?.[user?._id || ''] || 0;
    const isPinned = pinnedRooms.includes(room.roomId);
    const preview = decryptedPreviews[room.roomId];
    const previewText = preview
      ? (preview.length > 38 ? preview.substring(0, 38) + '…' : preview)
      : (room.isDM ? 'Click to start chatting' : 'No messages yet.');

    return (
      <div
        key={room.roomId}
        className={`room-item ${currentRoom?.roomId === room.roomId ? 'active' : ''}`}
        onClick={() => handleRoomSelect(room)}
      >
        <div className="avatar-wrapper">
          <div className="room-avatar" style={room.avatarColor ? { backgroundColor: room.avatarColor } : {}}>
            {getRoomAvatarChar(room)}
          </div>
          {isRoomOnline(room) && <div className="status-dot" />}
        </div>
        <div className="room-info">
          <div className="room-top">
            <span className="room-name">
              {isPinned && <span style={{ marginRight: 4, fontSize: 11 }}>📌</span>}
              {getRoomDisplayName(room)}
            </span>
            <span className="room-time">
              {room.lastMessage?.createdAt
                ? new Date(room.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : new Date(room.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="room-bottom">
            <span className={`room-preview ${preview?.endsWith('is typing...') ? 'typing' : ''}`}>
              {previewText}
            </span>
            {unreadCount > 0 && <span className="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </div>
        </div>
      </div>
    );
  };

  const renderChatsTab = () => (
    <>
      {/* Category Filter Pills */}
      <div className="category-tabs-container">
        {(['all', 'unread', 'groups', 'pinned'] as ChatFilter[]).map((f) => (
          <button
            key={f}
            className={`category-tab-pill ${chatFilter === f ? 'active' : ''}`}
            onClick={() => setChatFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="room-list-scroll-wrapper" style={{ flex: 1, overflowY: 'auto' }}>
        {/* DMs */}
        {chatFilter !== 'groups' && (
          <>
            <div className="sidebar-section-label">Direct Messages</div>
            <div className="room-list">
              {filteredDMs.length > 0
                ? filteredDMs.map(renderRoomItem)
                : <div className="sidebar-empty-hint">No messages. Add a friend to start chatting!</div>}
            </div>
          </>
        )}

        {/* Groups */}
        {chatFilter !== 'unread' && chatFilter !== 'pinned' && (
          <>
            <div className="sidebar-section-label">Groups</div>
            <div className="room-list">
              {filteredGroups.length > 0
                ? filteredGroups.map(renderRoomItem)
                : <div className="sidebar-empty-hint">No groups yet.</div>}
            </div>
          </>
        )}

        {/* Combined for unread/pinned filters */}
        {(chatFilter === 'unread' || chatFilter === 'pinned') && filteredGroups.length > 0 && (
          <div className="room-list">{filteredGroups.map(renderRoomItem)}</div>
        )}
      </div>
    </>
  );

  const renderCallsTab = () => (
    <div className="room-list-scroll-wrapper" style={{ flex: 1, overflowY: 'auto' }}>
      <div className="sidebar-section-label">Recent Calls</div>
      {MOCK_CALLS.map((call) => (
        <div key={call.id} className="call-log-item">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="room-avatar" style={{ fontSize: 18, background: call.missed ? '#ef444422' : 'var(--primary-low-opaque)' }}>
              {call.missed
                ? <PhoneMissed size={18} color="#ef4444" />
                : call.type === 'incoming'
                  ? <PhoneIncoming size={18} color="var(--primary)" />
                  : <PhoneOutgoing size={18} color="var(--primary)" />}
            </div>
            <div className="call-meta-info">
              <span className="room-name">{call.name}</span>
              <span className={`call-time-label ${call.missed ? 'missed' : ''}`}>
                {call.type === 'incoming' ? '↙ Incoming' : call.type === 'outgoing' ? '↗ Outgoing' : '✗ Missed'} · {call.time}
              </span>
            </div>
          </div>
          <button className="call-action-btn" title="Call back">
            <Phone size={18} />
          </button>
        </div>
      ))}
      <div className="sidebar-empty-hint" style={{ paddingTop: 8 }}>Voice &amp; video calling coming soon.</div>
    </div>
  );

  const renderPeopleTab = () => (
    <>
      {/* Sub-tab pills */}
      <div className="category-tabs-container">
        {([
          { id: 'list', label: `Friends (${friends.length})` },
          { id: 'search', label: 'Add Friend' },
          { id: 'requests', label: `Requests (${pendingRequests.length})` },
        ] as { id: PeopleTab; label: string }[]).map((t) => (
          <button
            key={t.id}
            className={`category-tab-pill ${peopleTab === t.id ? 'active' : ''}`}
            onClick={() => setPeopleTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="room-list-scroll-wrapper" style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>

        {/* Friends list */}
        {peopleTab === 'list' && (
          friends.length > 0
            ? friends.map((friend) => (
              <div 
                key={friend._id} 
                className="friend-inline-row"
                style={{ cursor: 'pointer' }}
                onClick={() => handleStartDM(friend._id)}
              >
                <div className="avatar-wrapper">
                  <div className="room-avatar">{friend.firstName.charAt(0).toUpperCase()}</div>
                  {friend.isOnline && <div className="status-dot" />}
                </div>
                <div className="room-info">
                  <span className="room-name">{friend.firstName} {friend.lastName}</span>
                  <span className="room-preview">{friend.email}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="create-room-btn"
                    title="Message"
                    onClick={(e) => { e.stopPropagation(); handleStartDM(friend._id); }}
                    disabled={actionLoading === friend._id}
                  >
                    <MessageSquare size={15} />
                  </button>
                  <button
                    className="create-room-btn"
                    title="Remove"
                    style={{ background: '#ef444415', color: '#ef4444' }}
                    onClick={(e) => { e.stopPropagation(); handleRemoveFriend(friend._id); }}
                    disabled={actionLoading === friend._id}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))
            : <div className="sidebar-empty-hint">👥 You haven't added any friends yet.</div>
        )}

        {/* Search */}
        {peopleTab === 'search' && (
          <>
            <div className="search-container" style={{ margin: '8px 8px 12px' }}>
              <Search className="search-icon" size={16} />
              <input
                type="text"
                placeholder="Search by name or email…"
                value={peopleSearch}
                onChange={(e) => setPeopleSearch(e.target.value)}
                autoFocus
              />
            </div>
            {searchResults.length > 0
              ? searchResults.map((u) => (
                <div 
                  key={u._id} 
                  className="friend-inline-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => alert("Profile screen is unimplemented.")}
                >
                  <div className="avatar-wrapper">
                    <div className="room-avatar">{u.firstName.charAt(0).toUpperCase()}</div>
                  </div>
                  <div className="room-info">
                    <span className="room-name">{u.firstName} {u.lastName}</span>
                    <span className="room-preview">{u.email}</span>
                  </div>
                  <button
                    className="create-room-btn"
                    title="Add Friend"
                    onClick={(e) => { e.stopPropagation(); handleSendRequest(u._id); }}
                    disabled={actionLoading === u._id}
                  >
                    <Send size={15} />
                  </button>
                </div>
              ))
              : peopleSearch.trim()
                ? <div className="sidebar-empty-hint">No users found.</div>
                : <div className="sidebar-empty-hint">🔍 Type a name or email to search.</div>}
          </>
        )}

        {/* Requests */}
        {peopleTab === 'requests' && (
          pendingRequests.length > 0
            ? pendingRequests.map((req) => {
              const isIncoming = req.recipient._id === user?._id;
              const other = isIncoming ? req.sender : req.recipient;
              return (
                <div 
                  key={req._id} 
                  className="friend-inline-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => alert("Profile screen is unimplemented.")}
                >
                  <div className="avatar-wrapper">
                    <div className="room-avatar">{other.firstName.charAt(0).toUpperCase()}</div>
                  </div>
                  <div className="room-info">
                    <span className="room-name">{other.firstName} {other.lastName}</span>
                    <span className="room-preview" style={{ fontStyle: 'italic' }}>
                      {isIncoming ? 'Incoming request' : 'Outgoing · Pending'}
                    </span>
                  </div>
                  {isIncoming ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="create-room-btn"
                        title="Accept"
                        style={{ background: '#22c55e22', color: '#22c55e' }}
                        onClick={(e) => { e.stopPropagation(); handleRespondRequest(req._id, 'accept'); }}
                        disabled={actionLoading === req._id}
                      >
                        <Check size={15} />
                      </button>
                      <button
                        className="create-room-btn"
                        title="Decline"
                        style={{ background: '#ef444422', color: '#ef4444' }}
                        onClick={(e) => { e.stopPropagation(); handleRespondRequest(req._id, 'reject'); }}
                        disabled={actionLoading === req._id}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
            : <div className="sidebar-empty-hint">✉️ No pending requests.</div>
        )}
      </div>
    </>
  );

  const renderSettingsTab = () => {
    if (settingsPanel === 'theme') {
      return (
        <>
          <div className="settings-subpanel-header">
            <button className="settings-back-btn" onClick={() => setSettingsPanel(null)}><ArrowLeft size={20} /></button>
            <span className="settings-subpanel-title">Theme</span>
          </div>
          <div className="room-list-scroll-wrapper" style={{ flex: 1, overflowY: 'auto' }}>
            <div className="settings-menu-list">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`settings-menu-option ${activeTheme === t.id ? 'active-theme' : ''}`}
                  onClick={() => applyTheme(t.id)}
                  style={activeTheme === t.id ? { borderColor: 'var(--primary)', background: 'var(--primary-low-opaque)' } : {}}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 22 }}>{t.emoji}</span>
                    <span className="settings-option-label">{t.label}</span>
                  </div>
                  {activeTheme === t.id && <Check size={18} color="var(--primary)" />}
                </button>
              ))}
            </div>
          </div>
        </>
      );
    }

    if (settingsPanel === 'profile') {
      return (
        <>
          <div className="settings-subpanel-header">
            <button className="settings-back-btn" onClick={() => setSettingsPanel(null)}><ArrowLeft size={20} /></button>
            <span className="settings-subpanel-title">Profile</span>
          </div>
          <div className="room-list-scroll-wrapper" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingBottom: 24 }}>
              <div className="room-avatar" style={{ width: 80, height: 80, fontSize: 32 }}>
                {user?.firstName?.charAt(0).toUpperCase()}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="room-name" style={{ fontSize: 20, marginBottom: 4 }}>{user?.firstName} {user?.lastName}</div>
                <div className="room-preview">{user?.email}</div>
              </div>
            </div>
            <div className="settings-menu-list">
              <div className="settings-menu-option" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>First Name</span>
                <span className="settings-option-label">{user?.firstName}</span>
              </div>
              <div className="settings-menu-option" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last Name</span>
                <span className="settings-option-label">{user?.lastName}</span>
              </div>
              <div className="settings-menu-option" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</span>
                <span className="settings-option-label">{user?.email}</span>
              </div>
            </div>
          </div>
        </>
      );
    }

    if (settingsPanel === 'storage') {
      return (
        <>
          <div className="settings-subpanel-header">
            <button className="settings-back-btn" onClick={() => setSettingsPanel(null)}><ArrowLeft size={20} /></button>
            <span className="settings-subpanel-title">Storage Manager</span>
          </div>
          <div className="room-list-scroll-wrapper" style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ padding: 12, borderRadius: 8, backgroundColor: 'var(--primary-low-opaque)', fontSize: 13, color: 'var(--text-muted)', lineHeight: '1.4' }}>
                🔒 Back up your chat history, offline queue, and sync status. The backup file is strictly isolated and can only be restored by your current logged-in account to enforce E2EE privacy invariants.
              </div>
              
              <button 
                className="settings-menu-option" 
                onClick={async () => {
                  try {
                    await syncEngine.backupService.exportBackup();
                    alert('Backup file successfully generated and exported!');
                  } catch (e: any) {
                    alert('Export failed: ' + (e?.message || e));
                  }
                }}
                style={{ padding: '16px', display: 'flex', justifyContent: 'center', backgroundColor: 'var(--primary)', color: 'white', borderRadius: 8 }}
              >
                Export Database Backup
              </button>

              <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }}></div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button 
                  className="settings-menu-option" 
                  onClick={() => document.getElementById('restore-file-input')?.click()}
                  style={{ padding: '16px', display: 'flex', justifyContent: 'center', border: '1px solid var(--primary)', color: 'var(--primary)', borderRadius: 8 }}
                >
                  Import / Restore Backup
                </button>
                <input 
                  type="file" 
                  id="restore-file-input" 
                  accept=".json" 
                  style={{ display: 'none' }}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                      const content = e.target?.result as string;
                      if (!content) return;
                      
                      const confirmRestore = window.confirm(
                        'WARNING: Restoring a backup will wipe your current local message cache and restore the snapshot from the file. Do you want to proceed?'
                      );
                      if (!confirmRestore) return;
                      
                      try {
                        const res = await syncEngine.backupService.restoreBackup(content);
                        if (res.success) {
                          alert('Database successfully restored! Re-initializing...');
                          window.location.reload();
                        } else {
                          alert(res.error || 'Restore failed.');
                        }
                      } catch (err: any) {
                        alert('Restore failed: ' + (err?.message || err));
                      }
                    };
                    reader.readAsText(file);
                  }}
                />
              </div>
            </div>
          </div>
        </>
      );
    }

    if (settingsPanel === 'privacy') {
      return <AppLockSettings onBack={() => setSettingsPanel(null)} />;
    }

    // Default settings menu
    return (
      <div className="room-list-scroll-wrapper" style={{ flex: 1, overflowY: 'auto' }}>
        {/* Profile card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 20px 12px' }}>
          <div className="room-avatar" style={{ width: 52, height: 52, fontSize: 20, flexShrink: 0 }}>
            {user?.firstName?.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="room-name" style={{ fontSize: 16, marginBottom: 2 }}>{user?.firstName} {user?.lastName}</div>
            <div className="room-preview">{user?.email}</div>
          </div>
        </div>

        <div className="settings-menu-list">
          <button className="settings-menu-option" onClick={() => setSettingsPanel('profile')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <User size={18} color="var(--primary)" />
              <span className="settings-option-label">Profile</span>
            </div>
            <ChevronRight size={18} color="var(--text-muted)" />
          </button>

          <button className="settings-menu-option" onClick={() => setSettingsPanel('theme')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Palette size={18} color="var(--primary)" />
              <span className="settings-option-label">Theme</span>
            </div>
            <ChevronRight size={18} color="var(--text-muted)" />
          </button>

          <button className="settings-menu-option" onClick={() => alert("Notifications screen is unimplemented.")}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Bell size={18} color="var(--primary)" />
              <span className="settings-option-label">Notifications</span>
            </div>
            <ChevronRight size={18} color="var(--text-muted)" />
          </button>

          <button className="settings-menu-option" onClick={() => setSettingsPanel('privacy')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Shield size={18} color="var(--primary)" />
              <span className="settings-option-label">Privacy &amp; Security</span>
            </div>
            <ChevronRight size={18} color="var(--text-muted)" />
          </button>

          <button className="settings-menu-option" onClick={() => setSettingsPanel('storage')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Database size={18} color="var(--primary)" />
              <span className="settings-option-label">Storage Manager</span>
            </div>
            <ChevronRight size={18} color="var(--text-muted)" />
          </button>

          {/* Logout */}
          <button
            className="settings-menu-option"
            onClick={() => dispatch(logoutUser())}
            style={{ borderColor: '#ef444430', marginTop: 8 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <LogOut size={18} color="#ef4444" />
              <span className="settings-option-label" style={{ color: '#ef4444' }}>Log Out</span>
            </div>
          </button>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <aside className={`sidebar ${!isOpen ? 'closed' : ''}`}>
      {/* ── Header (Chats tab only) ── */}
      {activeTab === 'chats' && (
        <div className="sidebar-header">
          <div className="sidebar-title">
            <h1>My Chats</h1>
            <div className="sidebar-header-actions" style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setActiveTab('people'); setPeopleTab('search'); }}
                className="create-room-btn"
                title="Add Friend"
              >
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
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* ── Tab section label headers (non-chats) ── */}
      {activeTab === 'calls' && (
        <div className="sidebar-header">
          <div className="sidebar-title"><h1>Calls</h1></div>
        </div>
      )}
      {activeTab === 'people' && (
        <div className="sidebar-header">
          <div className="sidebar-title"><h1>People</h1></div>
        </div>
      )}
      {activeTab === 'settings' && !settingsPanel && (
        <div className="sidebar-header">
          <div className="sidebar-title"><h1>Settings</h1></div>
        </div>
      )}

      {/* ── Tab content ── */}
      {activeTab === 'chats' && renderChatsTab()}
      {activeTab === 'calls' && renderCallsTab()}
      {activeTab === 'people' && renderPeopleTab()}
      {activeTab === 'settings' && renderSettingsTab()}

      {/* ── Bottom Navigation ── */}
      <nav className="sidebar-bottom-nav">
        <button
          className={`nav-tab-btn ${activeTab === 'chats' ? 'active' : ''}`}
          onClick={() => setActiveTab('chats')}
          title="Chats"
        >
          <MessageSquare size={22} />
          <span>Chats</span>
        </button>
        <button
          className={`nav-tab-btn ${activeTab === 'calls' ? 'active' : ''}`}
          onClick={() => setActiveTab('calls')}
          title="Calls"
        >
          <Phone size={22} />
          <span>Calls</span>
        </button>
        <button
          className={`nav-tab-btn ${activeTab === 'people' ? 'active' : ''}`}
          onClick={() => setActiveTab('people')}
          title="People"
        >
          <Users size={22} />
          <span>People</span>
        </button>
        <button
          className={`nav-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => { setActiveTab('settings'); setSettingsPanel(null); }}
          title="Settings"
        >
          <Settings size={22} />
          <span>Settings</span>
        </button>
      </nav>

      {/* ── Create Group Modal (unchanged) ── */}
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
              <div className="form-group" style={{ marginTop: 16 }}>
                <label>Select Participants</label>
                <div className="friends-selection-list" style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 6, padding: 8, marginTop: 8 }}>
                  {friendsList.length > 0
                    ? friendsList.map((friend) => (
                      <div key={friend._id} style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                        <input
                          type="checkbox"
                          id={`friend-${friend._id}`}
                          value={friend._id}
                          checked={selectedFriends.includes(friend._id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedFriends([...selectedFriends, friend._id]);
                            else setSelectedFriends(selectedFriends.filter((id) => id !== friend._id));
                          }}
                          style={{ marginRight: 8 }}
                        />
                        <label htmlFor={`friend-${friend._id}`} style={{ margin: 0, cursor: 'pointer', fontSize: 14 }}>
                          {friend.firstName} {friend.lastName}
                        </label>
                      </div>
                    ))
                    : <div style={{ fontSize: 13, color: '#94A3B8', padding: 4 }}>No friends available.</div>}
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: 24 }}>
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary" disabled={isCreating}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isCreating}>
                  {isCreating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
