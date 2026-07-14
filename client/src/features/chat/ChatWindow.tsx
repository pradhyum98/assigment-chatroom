import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setMessages, clearTyping, selectVisibleMessages, setDecryptedMessageContent } from './chatSlice';
import { clearUnreadCount, setCurrentRoom } from '../rooms/roomsSlice';
import api, { getAccessToken } from '../../services/api';
import { TransportConfig } from '../../config/TransportConfig';
import { UploadService } from '../../services/uploadService';
import { socketService } from '../../services/socket';
import { Send, Mic, Plus, CheckCheck, Check, Loader2, Edit2, Trash2, Smile, FileText, Download, Phone, Video, MessageSquare, X, Pin, ArrowLeft, Copy, Forward, Star, Image, File, VolumeX, Ban, Search, Users, User, AlertTriangle } from 'lucide-react';
import { useCall } from '../calls/CallContext';
import VoiceRecorder from '../media/VoiceRecorder';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import { useCrypto } from '../../hooks/useCrypto';
import { CryptoService } from '../../services/cryptoService';
import { ImageViewer } from './ImageViewer';
import { syncEngine } from '../../services/SyncEngine';
import { canonicalDb } from '../../services/CanonicalDatabase';
import './Chat.css';

const getMediaUrl = (urlPath: string) => {
  if (!urlPath) return '';
  if (urlPath.startsWith('http')) return urlPath;
  const token = getAccessToken();
  const serverUrl = TransportConfig.mediaOrigin;
  return `${serverUrl}${urlPath}?token=${token}`;
};

interface ChatWindowProps {
  onBack?: () => void;
}

const generateUUID = (): string => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const ChatWindow: React.FC<ChatWindowProps> = ({ onBack }) => {
  const dispatch = useAppDispatch();
  const { rooms, currentRoom } = useAppSelector((state) => state.rooms);
  const { user } = useAppSelector((state) => state.auth);
  const { friends } = useAppSelector((state) => state.friends);
  const { messages, typingUsers } = useAppSelector((state) => state.chat);
  const visibleMessages = useAppSelector((state) =>
    currentRoom ? selectVisibleMessages(state, currentRoom.roomId, user?._id) : []
  );
  const { startCall } = useCall();
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [showPinned, setShowPinned] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const { getRoomKey, encryptPayload, decryptPayload } = useCrypto();

  const [activeImageView, setActiveImageView] = useState<string | null>(null);
  
  // Custom states for production UX pass
  const [contextMenuMsg, setContextMenuMsg] = useState<any | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<any | null>(null);
  const [showEmojiPickerMsg, setShowEmojiPickerMsg] = useState<any | null>(null);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [showAttachmentPopover, setShowAttachmentPopover] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [chatWallpaper, setChatWallpaper] = useState('#f8fafc');
  const [forwardMsg, setForwardMsg] = useState<any | null>(null);
  const [starredTrigger, setStarredTrigger] = useState(0);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [failedMedia, setFailedMedia] = useState<Record<string, boolean>>({});

  const [decryptedUrls, setDecryptedUrls] = useState<Record<string, string>>({});
  const decryptedUrlsRef = useRef<Record<string, string>>({});
  const [isNetworkOnline, setIsNetworkOnline] = useState(navigator.onLine);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollStateRef = useRef({ prevScrollHeight: 0, prevScrollTop: 0, adjustScroll: false });
  const lastRoomIdRef = useRef<string | null>(null);
  const createdObjectUrlsRef = useRef<string[]>([]);
  const decryptedTextIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleOnline = () => setIsNetworkOnline(true);
    const handleOffline = () => setIsNetworkOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!currentRoom || !messages.length) return;

    const decryptNewMedia = async () => {
      const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
      if (!roomKey) return;

      let updated = false;
      const newUrls = { ...decryptedUrlsRef.current };

      for (const msg of messages as any[]) {
        const cacheKey = msg.clientMsgId || msg.messageId || msg._id;
        if (!cacheKey) continue;

        const hasMedia = msg.type !== 'text' && msg.mediaUrl && 
          ((msg.encryptionVersion === 2 && msg.wrappedMediaKey && msg.mediaKeyIv && msg.mediaIv) || 
           (msg.mediaKey && msg.mediaIv));

        if (hasMedia && !msg.decryptedMediaUrl && !newUrls[cacheKey] && !failedMedia[cacheKey]) {
          try {
            const activeToken = getAccessToken();
            const headers: Record<string, string> = {};
            if (activeToken) {
              headers['Authorization'] = `Bearer ${activeToken}`;
            }
            const fileRes = await fetch(getMediaUrl(msg.mediaUrl || ''), { headers });
            const encryptedBlob = await fileRes.blob();
            
            let fileKey: any;
            if (msg.encryptionVersion === 2) {
              fileKey = await CryptoService.unwrapMediaKey(
                msg.wrappedMediaKey,
                msg.mediaKeyIv,
                roomKey,
                {
                  roomId: currentRoom.roomId,
                  clientMsgId: msg.clientMsgId,
                  encryptionVersion: 2
                }
              );
            } else {
              fileKey = msg.mediaKey;
            }

            const objectUrl = await CryptoService.decryptFile(
              encryptedBlob,
              fileKey,
              msg.mediaIv || msg.mediaKeyIv,
              msg.mediaMimeType || 'application/octet-stream'
            );
            createdObjectUrlsRef.current.push(objectUrl);
            newUrls[cacheKey] = objectUrl;
            updated = true;
          } catch (e) {
            console.error('Failed to decrypt incoming media', cacheKey, e);
          }
        }
      }

      if (updated) {
        decryptedUrlsRef.current = newUrls;
        setDecryptedUrls(newUrls);
      }
    };

    decryptNewMedia();
  }, [messages, currentRoom, failedMedia, isNetworkOnline]);

  // Decrypt incoming real-time text messages as they arrive via socket & Redux
  useEffect(() => {
    if (!currentRoom) return;

    // Reset decrypted cache if room changes
    if (lastRoomIdRef.current !== currentRoom.roomId) {
      decryptedTextIdsRef.current.clear();
      lastRoomIdRef.current = currentRoom.roomId;
    }

    if (!visibleMessages.length) return;

    const decryptPendingMessages = async () => {
      const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
      if (!roomKey) return;

      for (const msg of visibleMessages as any[]) {
        const msgId = msg.messageId || msg._id;
        if (!msgId) continue;

        const isEncryptedText = msg.iv && msg.content && (!msg.type || msg.type === 'text');
        const needsDecryption = isEncryptedText && !decryptedTextIdsRef.current.has(msgId);

        if (needsDecryption) {
          decryptedTextIdsRef.current.add(msgId);
          try {
            const decryptedContent = await decryptPayload(msg.content, msg.iv, roomKey);
            dispatch(setDecryptedMessageContent({ messageId: msgId, content: decryptedContent }));
          } catch (e) {
            console.error('Failed to decrypt incoming real-time message text:', msgId, e);
          }
        }
      }
    };

    decryptPendingMessages();
  }, [visibleMessages, currentRoom, dispatch]);

  useEffect(() => {
    const handleOutsideClick = () => {
      setContextMenuMsg(null);
      setContextMenuPos(null);
      setShowHeaderMenu(false);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (currentRoom) {
      setChatWallpaper(localStorage.getItem(`wallpaper_${currentRoom.roomId}`) || '#f8fafc');
    }
  }, [currentRoom?.roomId]);

  const getTargetRoomKey = async (roomId: string, encryptedRoomKeys: any) => {
    try {
      const savedKey = localStorage.getItem(`room_key_${roomId}`);
      if (savedKey) {
        return await CryptoService.importRoomKey(savedKey);
      }
      const privKeyBase64 = localStorage.getItem('e2e_private_key');
      if (privKeyBase64 && encryptedRoomKeys) {
        const rawKey = encryptedRoomKeys[user?._id || ''];
        const myEncKey = rawKey && typeof rawKey === 'object' ? rawKey.encryptedKey : rawKey;
        if (myEncKey) {
          const privKey = await CryptoService.importPrivateKey(privKeyBase64);
          const roomKeyStr = await CryptoService.decryptRoomKey(myEncKey, privKey);
          localStorage.setItem(`room_key_${roomId}`, roomKeyStr);
          return await CryptoService.importRoomKey(roomKeyStr);
        }
      }
    } catch (e) {
      console.error('Failed to decrypt room key for forwarding', e);
    }
    return null;
  };

  // ── Object URL Cleanup to Prevent Memory Leaks ─────────────────────────────
  useEffect(() => {
    return () => {
      console.log('[Cleanup] Revoking decrypted object URLs:', createdObjectUrlsRef.current.length);
      createdObjectUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          console.error('Failed to revoke URL', e);
        }
      });
      createdObjectUrlsRef.current = [];
    };
  }, [currentRoom?.roomId]);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileBuffer, setSelectedFileBuffer] = useState<ArrayBuffer | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [filePreviewUrl]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert('File size exceeds the 10MB limit.');
      return;
    }

    try {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });
      setSelectedFile(file);
      setSelectedFileBuffer(buffer);

      if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        const url = URL.createObjectURL(file);
        setFilePreviewUrl(url);
      } else {
        setFilePreviewUrl(null);
      }
    } catch (err) {
      console.error('Failed to read file immediately:', err);
      alert('Failed to read file due to permission problems. Please try selecting the file again.');
    }
  };

  const cancelFileSelection = () => {
    setSelectedFile(null);
    setSelectedFileBuffer(null);
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
    if (videoInputRef.current) {
      videoInputRef.current.value = '';
    }
  };
  
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const topOfMessagesRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const getOtherParticipant = () => {
    if (!currentRoom || !currentRoom.isDM) return null;
    const otherParticipantRaw = currentRoom.participants?.find(
      (p: any) => (typeof p === 'string' ? p : p._id) !== user?._id
    );
    const otherParticipantId = typeof otherParticipantRaw === 'string' ? otherParticipantRaw : otherParticipantRaw?._id;
    return otherParticipantId ? (friends.find((f: any) => f._id === otherParticipantId) || (typeof otherParticipantRaw === 'object' ? otherParticipantRaw : null)) : null;
  };

  const getRoomDisplayName = () => {
    if (!currentRoom) return '';
    if (currentRoom.isDM) {
      const otherParticipant = getOtherParticipant();
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

  const handleStartCall = () => {
    if (!currentRoom || !currentRoom.isDM) {
      alert('Calls are only available in Direct Messages for now.');
      return;
    }
    const otherParticipant = getOtherParticipant();
    if (!otherParticipant) return;
    
    startCall(
      currentRoom.roomId,
      otherParticipant._id,
      `${otherParticipant.firstName} ${otherParticipant.lastName}`,
      'audio'
    );
  };

  const handleStartVideoCall = () => {
    if (!currentRoom || !currentRoom.isDM) {
      alert('Calls are only available in Direct Messages for now.');
      return;
    }
    const otherParticipant = getOtherParticipant();
    if (!otherParticipant) return;
    
    startCall(
      currentRoom.roomId,
      otherParticipant._id,
      `${otherParticipant.firstName} ${otherParticipant.lastName}`,
      'video'
    );
  };

  useEffect(() => {
    const fetchMessages = async () => {
      if (!currentRoom) return;
      setIsLoading(true);
      // Clear the decrypted-IDs cache whenever we load a new room so the socket
      // useEffect starts fresh. We will re-populate it below with every message
      // returned by this REST fetch so those are never double-decrypted.
      decryptedTextIdsRef.current.clear();
      try {
        const response = await api.get(`/messages/${currentRoom.roomId}`);
        let fetchedMessages = response.data.data.messages;

        // Decrypt messages if needed
        const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
        if (roomKey) {
          fetchedMessages = await Promise.all(fetchedMessages.map(async (msg: any) => {
            let processedMsg = { ...msg };
            
            if (msg.iv && msg.content) {
              try {
                processedMsg.content = await decryptPayload(msg.content, msg.iv, roomKey);
              } catch (e) {
                console.error('Failed to decrypt message', msg.messageId, e);
                processedMsg.content = '[Decryption Failed]';
              }
            }
            
            const hasMedia = msg.type !== 'text' && msg.mediaUrl && 
              ((msg.encryptionVersion === 2 && msg.wrappedMediaKey && msg.mediaKeyIv && msg.mediaIv) || 
               (msg.mediaKey && msg.mediaIv));

            if (hasMedia) {
              try {
                const activeToken = getAccessToken();
                const headers: Record<string, string> = {};
                if (activeToken) {
                  headers['Authorization'] = `Bearer ${activeToken}`;
                }
                const fileRes = await fetch(getMediaUrl(msg.mediaUrl), { headers });
                const encryptedBlob = await fileRes.blob();
                
                let fileKey: any;
                if (msg.encryptionVersion === 2) {
                  fileKey = await CryptoService.unwrapMediaKey(
                    msg.wrappedMediaKey,
                    msg.mediaKeyIv,
                    roomKey,
                    {
                      roomId: currentRoom.roomId,
                      clientMsgId: msg.clientMsgId,
                      encryptionVersion: 2
                    }
                  );
                } else {
                  fileKey = msg.mediaKey;
                }

                const objectUrl = await CryptoService.decryptFile(
                  encryptedBlob,
                  fileKey,
                  msg.mediaIv || msg.mediaKeyIv,
                  msg.mediaMimeType || 'application/octet-stream'
                );
                createdObjectUrlsRef.current.push(objectUrl);
                processedMsg.decryptedMediaUrl = objectUrl;
              } catch (e) {
                console.error('Failed to decrypt media', msg.messageId, e);
              }
            }

            return processedMsg;
          }));
        }

        // Mark every fetched message as already-decrypted so the socket
        // real-time useEffect never tries to re-decrypt them (which would fail
        // on plaintext and return '[Encrypted Message]').
        fetchedMessages.forEach((m: any) => {
          const id = m.messageId || m._id;
          if (id) decryptedTextIdsRef.current.add(id);
        });

        dispatch(setMessages(fetchedMessages));
        setHasMore(response.data.data.pagination.hasMore);
        
        // Mark as read if there are messages
        if (fetchedMessages.length > 0 && user) {
          const unreadMessageIds = fetchedMessages
            .filter((m: any) => m.senderId !== user._id && !m.readBy?.some((r: any) => r.userId === user._id))
            .map((m: any) => m.messageId || m._id);
            
          if (unreadMessageIds.length > 0) {
            socketService.markAsRead({ roomId: currentRoom.roomId, messageIds: unreadMessageIds });
            dispatch(clearUnreadCount({ roomId: currentRoom.roomId, userId: user._id }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch messages from server, falling back to local DB cache:', err);
        try {
          if (user?._id) {
            const allLocalMsgs = await canonicalDb.getAll<any>(
              'message_projections',
              IDBKeyRange.bound([user._id, ''], [user._id, '\uffff'])
            );
            let localRoomMsgs = allLocalMsgs.filter((m: any) => m.roomId === currentRoom.roomId);

            const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
            if (roomKey) {
              localRoomMsgs = await Promise.all(
                localRoomMsgs.map(async (msg: any) => {
                  let processedMsg = { ...msg };
                  if (msg.iv && msg.content) {
                    try {
                      processedMsg.content = await decryptPayload(msg.content, msg.iv, roomKey);
                    } catch (e) {
                      console.error('Failed to decrypt local offline message', msg.messageId, e);
                    }
                  }
                  return processedMsg;
                })
              );
            }

            localRoomMsgs.sort((a: any, b: any) => {
              if (a.sequenceNumber !== undefined && b.sequenceNumber !== undefined) {
                return a.sequenceNumber - b.sequenceNumber;
              }
              return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
            });

            // Mark local fallback messages as already-decrypted too
            localRoomMsgs.forEach((m: any) => {
              const id = m.messageId || m._id;
              if (id) decryptedTextIdsRef.current.add(id);
            });

            dispatch(setMessages(localRoomMsgs));
            setHasMore(false);
          }
        } catch (localErr) {
          console.error('Failed to load offline messages from local DB:', localErr);
        }
      } finally {
         setIsLoading(false);
      }
    };

    fetchMessages();
    dispatch(clearTyping());
    setEditingMessageId(null);
    setReplyingTo(null);
  }, [currentRoom?.roomId, dispatch, user]);

  useEffect(() => {
    if (isLoading || isLoadingMore || !hasMore || !messages.length) return;

    const options = { root: null, rootMargin: '20px', threshold: 1.0 };
    const observer = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (first.isIntersecting && hasMore) {
        loadMoreMessages();
      }
    }, options);

    if (topOfMessagesRef.current) observer.observe(topOfMessagesRef.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [messages, hasMore, isLoading, isLoadingMore]);

  const loadMoreMessages = async () => {
    if (!currentRoom || messages.length === 0) return;
    
    if (messagesContainerRef.current) {
      scrollStateRef.current.prevScrollHeight = messagesContainerRef.current.scrollHeight;
      scrollStateRef.current.prevScrollTop = messagesContainerRef.current.scrollTop;
      scrollStateRef.current.adjustScroll = true;
    }
    
    setIsLoadingMore(true);
    try {
      const beforeDate = messages[0].timestamp;
      const response = await api.get(`/messages/${currentRoom.roomId}?before=${beforeDate}`);
      let olderMessages = response.data.data.messages;

      // Decrypt messages if needed
      const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
      if (roomKey) {
        olderMessages = await Promise.all(olderMessages.map(async (msg: any) => {
          if (msg.iv && msg.content) {
            try {
              const decryptedContent = await decryptPayload(msg.content, msg.iv, roomKey);
              msg.content = decryptedContent;
            } catch (e) {
              console.error('Failed to decrypt message', msg.messageId, e);
              msg.content = '[Decryption Failed]';
            }
          }
          const hasMedia = msg.type !== 'text' && msg.mediaUrl && 
            ((msg.encryptionVersion === 2 && msg.wrappedMediaKey && msg.mediaKeyIv && msg.mediaIv) || 
             (msg.mediaKey && msg.mediaIv));

          if (hasMedia) {
            try {
              const activeToken = getAccessToken();
              const headers: Record<string, string> = {};
              if (activeToken) {
                headers['Authorization'] = `Bearer ${activeToken}`;
              }
              const fileRes = await fetch(getMediaUrl(msg.mediaUrl), { headers });
              const encryptedBlob = await fileRes.blob();
              
              let fileKey: any;
              if (msg.encryptionVersion === 2) {
                fileKey = await CryptoService.unwrapMediaKey(
                  msg.wrappedMediaKey,
                  msg.mediaKeyIv,
                  roomKey,
                  {
                    roomId: currentRoom.roomId,
                    clientMsgId: msg.clientMsgId,
                    encryptionVersion: 2
                  }
                );
              } else {
                fileKey = msg.mediaKey;
              }

              const objectUrl = await CryptoService.decryptFile(
                encryptedBlob,
                fileKey,
                msg.mediaIv || msg.mediaKeyIv,
                msg.mediaMimeType || 'application/octet-stream'
              );
              createdObjectUrlsRef.current.push(objectUrl);
              msg.decryptedMediaUrl = objectUrl;
            } catch (e) {
              console.error('Failed to decrypt media', msg.messageId, e);
            }
          }

          return msg;
        }));
      }
      
      if (olderMessages.length > 0) {
        dispatch(setMessages([...olderMessages, ...messages]));
      }
      setHasMore(response.data.data.pagination.hasMore);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useLayoutEffect(() => {
    if (!messagesContainerRef.current) return;

    const currentRoomId = currentRoom?.roomId || null;
    const isNewRoom = currentRoomId !== lastRoomIdRef.current;
    lastRoomIdRef.current = currentRoomId;

    if (isNewRoom) {
      // On new room loading, scroll to the bottom
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      scrollStateRef.current.adjustScroll = false;
      return;
    }

    if (scrollStateRef.current.adjustScroll) {
      // Adjust scroll position after prepending messages
      const nextScrollHeight = messagesContainerRef.current.scrollHeight;
      const diff = nextScrollHeight - scrollStateRef.current.prevScrollHeight;
      messagesContainerRef.current.scrollTop = scrollStateRef.current.prevScrollTop + diff;
      scrollStateRef.current.adjustScroll = false;
      setIsLoadingMore(false);
    } else {
      const container = messagesContainerRef.current;
      const isNearBottom = container.scrollHeight - container.clientHeight - container.scrollTop < 250;
      
      const lastMsg = visibleMessages[visibleMessages.length - 1];
      const isSentByMe = lastMsg && lastMsg.senderId === user?._id;

      if (isSentByMe || isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }
    }
  }, [visibleMessages, currentRoom, user]);

  // Star message helpers
  const toggleStarMessage = (msgId: string) => {
    if (!currentRoom) return;
    const key = `starred_${currentRoom.roomId}`;
    const starred = JSON.parse(localStorage.getItem(key) || '[]');
    const index = starred.indexOf(msgId);
    if (index !== -1) {
      starred.splice(index, 1);
    } else {
      starred.push(msgId);
    }
    localStorage.setItem(key, JSON.stringify(starred));
    setStarredTrigger(prev => prev + 1);
  };

  const isMessageStarred = (msgId: string) => {
    if (!currentRoom) return false;
    const key = `starred_${currentRoom.roomId}`;
    const starred = JSON.parse(localStorage.getItem(key) || '[]');
    return starred.includes(msgId);
  };

  // Delete message for me locally
  const handleDeleteForMe = (msg: any) => {
    if (!currentRoom) return;
    const key = `deleted_for_me_${currentRoom.roomId}`;
    const deleted = JSON.parse(localStorage.getItem(key) || '[]');
    const id = msg.messageId || msg._id;
    if (!deleted.includes(id)) {
      deleted.push(id);
    }
    localStorage.setItem(key, JSON.stringify(deleted));
    setStarredTrigger(prev => prev + 1); // Reuse trigger to refresh views
  };

  const handleCopyMessage = (msg: any) => {
    if (msg.content) {
      navigator.clipboard.writeText(msg.content);
      alert('Message copied to clipboard.');
    }
  };

  const handleContextMenuTrigger = (e: React.MouseEvent, msg: any) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuMsg(msg);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleForwardMessage = async (targetRoom: any) => {
    if (!forwardMsg || !user) return;
    try {
      let contentToSend = forwardMsg.content;
      let ivToSend = forwardMsg.iv;

      // If text message and targetRoom has E2EE keys, encrypt it for the new room
      if (forwardMsg.type === 'text' && forwardMsg.content) {
        const roomKey = await getTargetRoomKey(targetRoom.roomId, targetRoom.encryptedRoomKeys);
        if (roomKey) {
          const encResult = await encryptPayload(forwardMsg.content, roomKey);
          contentToSend = encResult.ciphertext;
          ivToSend = encResult.iv;
        }
      }

      const clientMsgId = generateUUID();
      await syncEngine.enqueueMutation({
        mutationId: generateUUID(),
        clientMsgId,
        accountId: user._id,
        roomId: targetRoom.roomId,
        actionType: 'SEND_MESSAGE',
        createdAt: new Date().toISOString(),
        status: 'PENDING',
        payload: {
          senderId: user._id,
          senderName: `${user.firstName} ${user.lastName}`,
          content: contentToSend,
          iv: ivToSend,
          timestamp: new Date().toISOString(),
          type: (forwardMsg.type || 'text') as any,
          mediaUrl: forwardMsg.mediaUrl,
          mediaFilename: forwardMsg.mediaFilename,
          mediaMimeType: forwardMsg.mediaMimeType,
          mediaSize: forwardMsg.mediaSize,
          wrappedMediaKey: forwardMsg.wrappedMediaKey || forwardMsg.mediaKey,
          mediaKeyIv: forwardMsg.mediaKeyIv,
          mediaIv: forwardMsg.mediaIv
        }
      });
      alert(`Message forwarded to ${targetRoom.roomName || 'chat'}`);
    } catch (e) {
      console.error('Failed to forward message', e);
      alert('Failed to forward message.');
    } finally {
      setForwardMsg(null);
    }
  };

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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRoom || !user) return;

    const hasText = !!newMessage.trim();
    const hasFile = !!selectedFile;

    if (!hasText && !hasFile) return;

    if (editingMessageId) {
      const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
      let contentToSend = newMessage.trim();
      let ivToSend: string | undefined = undefined;

      if (roomKey) {
        try {
          const encResult = await encryptPayload(contentToSend, roomKey);
          contentToSend = encResult.ciphertext;
          ivToSend = encResult.iv;
        } catch (e) {
          console.error("Failed to encrypt edited message", e);
          return;
        }
      }

      await syncEngine.enqueueMutation({
        mutationId: generateUUID(),
        accountId: user._id,
        roomId: currentRoom.roomId,
        actionType: 'EDIT_MESSAGE',
        createdAt: new Date().toISOString(),
        status: 'PENDING',
        payload: {
          messageId: editingMessageId,
          content: contentToSend,
          editedAt: new Date().toISOString(),
          iv: ivToSend
        }
      });
      setEditingMessageId(null);
      setNewMessage('');
      return;
    }

    try {
      let mediaData: { url: string; filename: string; mimetype: string; size: number; type: 'image' | 'video' | 'audio' | 'file' } | null = null;

      let mediaKeyIvToSend: string | undefined = undefined;
      let wrappedMediaKeyToSend: string | undefined = undefined;
      let mediaIvToSend: string | undefined = undefined;
      let encryptionVersionToSend: number | undefined = undefined;

      const clientMsgId = generateUUID();

      if (selectedFile) {
        setIsUploading(true);
        // Encrypt the file before uploading
        const { encryptedBlob, fileKey, ivBase64 } = await CryptoService.encryptFile(selectedFileBuffer || selectedFile);
        
        // Convert Blob to File to upload
        const encryptedFileToUpload = new (window as any).File([encryptedBlob], selectedFile.name, { type: 'application/octet-stream' }) as File;
        const uploadResult = await UploadService.uploadFileResumable(encryptedFileToUpload, currentRoom.roomId);
        mediaData = uploadResult.data;
        
        // Ensure type maps back since we uploaded as octet-stream
        if (selectedFile.type.startsWith('image/')) mediaData.type = 'image';
        else if (selectedFile.type.startsWith('video/')) mediaData.type = 'video';
        else if (selectedFile.type.startsWith('audio/')) mediaData.type = 'audio';
        else mediaData.type = 'file';
        
        mediaData.mimetype = selectedFile.type;

        // Wrap media key using room key and context binding
        const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
        if (!roomKey) throw new Error('Cannot send media without room key');
        
        const { wrappedKey, wrapIv } = await CryptoService.wrapMediaKey(fileKey, roomKey, {
          roomId: currentRoom.roomId,
          clientMsgId,
          encryptionVersion: 2
        });

        wrappedMediaKeyToSend = wrappedKey;
        mediaKeyIvToSend = wrapIv;
        mediaIvToSend = ivBase64;
        encryptionVersionToSend = 2;

        cancelFileSelection();
      }

      const displayContent = newMessage.trim();
      let contentToSend = displayContent;
      let ivToSend: string | undefined = undefined;

      const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
      if (roomKey && contentToSend) {
        try {
          const encResult = await encryptPayload(contentToSend, roomKey);
          contentToSend = encResult.ciphertext;
          ivToSend = encResult.iv;
        } catch (e) {
          console.error("Failed to encrypt new message", e);
          return;
        }
      }

      await syncEngine.enqueueMutation({
        mutationId: generateUUID(),
        clientMsgId,
        accountId: user._id,
        roomId: currentRoom.roomId,
        actionType: 'SEND_MESSAGE',
        createdAt: new Date().toISOString(),
        status: 'PENDING',
        payload: {
          senderId: user._id,
          senderName: `${user.firstName} ${user.lastName}`,
          content: contentToSend,
          displayContent,
          iv: ivToSend,
          timestamp: new Date().toISOString(),
          type: mediaData ? (mediaData.type as any) : 'text',
          replyTo: replyingTo ? (replyingTo.messageId || replyingTo._id) : undefined,
          mediaUrl: mediaData?.url,
          mediaFilename: mediaData?.filename,
          mediaMimeType: mediaData?.mimetype,
          mediaSize: mediaData?.size,
          encryptionVersion: encryptionVersionToSend as any,
          wrappedMediaKey: wrappedMediaKeyToSend,
          mediaKeyIv: mediaKeyIvToSend,
          mediaIv: mediaIvToSend
        }
      });
      setNewMessage('');
      setReplyingTo(null);
      socketService.setTyping({ roomId: currentRoom.roomId, isTyping: false });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      alert(`Failed to send message: ${errorMsg}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendVoice = async (audioBlob: Blob) => {
    if (!currentRoom || !user) return;
    setIsRecordingVoice(false);
    setIsUploading(true);

    try {
      const clientMsgId = generateUUID();
      // Encrypt the file before uploading
      const file = new (window as any).File([audioBlob], 'voice-message.webm', { type: 'audio/webm' }) as File;
      const { encryptedBlob, fileKey, ivBase64 } = await CryptoService.encryptFile(file);
      
      const encryptedFileToUpload = new (window as any).File([encryptedBlob], 'voice-message.webm', { type: 'application/octet-stream' }) as File;
      const uploadResult = await UploadService.uploadFileResumable(encryptedFileToUpload, currentRoom.roomId);
      const mediaData = uploadResult.data;

      // Wrap media key
      const roomKey = await getRoomKey(currentRoom.roomId, currentRoom.encryptedRoomKeys);
      if (!roomKey) throw new Error('Cannot send media without room key');
      const { wrappedKey, wrapIv } = await CryptoService.wrapMediaKey(fileKey, roomKey, {
        roomId: currentRoom.roomId,
        clientMsgId,
        encryptionVersion: 2
      });

      await syncEngine.enqueueMutation({
        mutationId: generateUUID(),
        clientMsgId,
        accountId: user._id,
        roomId: currentRoom.roomId,
        actionType: 'SEND_MESSAGE',
        createdAt: new Date().toISOString(),
        status: 'PENDING',
        payload: {
          senderId: user._id,
          senderName: `${user.firstName} ${user.lastName}`,
          content: '',
          timestamp: new Date().toISOString(),
          type: 'audio',
          mediaUrl: mediaData.url,
          mediaFilename: mediaData.filename,
          mediaMimeType: 'audio/webm',
          mediaSize: mediaData.size,
          encryptionVersion: 2,
          wrappedMediaKey: wrappedKey,
          mediaKeyIv: wrapIv,
          mediaIv: ivBase64
        }
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      alert(`Failed to send voice message: ${errorMsg}`);
    } finally {
      setIsUploading(false);
    }
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
    if (!currentRoom || !user) return;
    syncEngine.enqueueMutation({
      mutationId: generateUUID(),
      accountId: user._id,
      roomId: currentRoom.roomId,
      actionType: 'DELETE_MESSAGE',
      createdAt: new Date().toISOString(),
      status: 'PENDING',
      payload: {
        messageId: msg.messageId || msg._id,
        deletedForEveryone: forEveryone
      }
    });
  };

  const handleReact = (msg: any, emoji: string) => {
    if (!currentRoom || !user) return;
    const reactions = msg.reactions || [];
    const hasReacted = reactions.some((r: any) => r.userId === user._id && r.emoji === emoji);
    const actionType = hasReacted ? 'REMOVE_REACTION' : 'ADD_REACTION';

    syncEngine.enqueueMutation({
      mutationId: generateUUID(),
      accountId: user._id,
      roomId: currentRoom.roomId,
      actionType,
      createdAt: new Date().toISOString(),
      status: 'PENDING',
      payload: {
        messageId: msg.messageId || msg._id,
        emoji,
        userId: user._id
      }
    });
  };

  const handlePin = async (msg: any) => {
    if (!currentRoom) return;
    try {
      await api.post(`/messages/${currentRoom.roomId}/pin/${msg.messageId || msg._id}`);
      await api.get(`/rooms`);
    } catch (e) {
      console.error(e);
      alert('Failed to pin/unpin message');
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!currentRoom) return;
    
    try {
      // Create new room keys for remaining participants
      const remainingParticipants = currentRoom.participants.filter((p: any) => p._id !== memberId);
      
      const newRoomKey = await CryptoService.generateRoomKey();
      const newRoomKeyBase64 = await CryptoService.exportRoomKey(newRoomKey);
      const encryptedRoomKeys: Record<string, { encryptedKey: string; identityVersion: number }> = {};
      
      for (const p of remainingParticipants) {
        if (p.publicKey) {
          const encryptedKey = await CryptoService.encryptRoomKeyForUser(newRoomKeyBase64, p.publicKey);
          encryptedRoomKeys[p._id] = {
            encryptedKey,
            identityVersion: p.identityVersion || 1,
          };
        }
      }

      await api.delete(`/rooms/${currentRoom.roomId}/members/${memberId}`, {
        data: { encryptedRoomKeys }
      });
      
      alert('Member removed and keys rotated successfully.');
      setShowMembers(false);
      // Let the room fetch update the state, or trigger a fetch
      await api.get(`/rooms`);
    } catch (err: any) {
      alert(`Failed to remove member: ${err.response?.data?.message || err.message}`);
    }
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

  const roomTypers = typingUsers[currentRoom.roomId] || {};
  const activeTypers = Object.values(roomTypers).filter(name => name !== `${user?.firstName} ${user?.lastName}`);

  const clearedTime = currentRoom ? localStorage.getItem(`clear_chat_${currentRoom.roomId}`) : null;
  const deletedForMeList = currentRoom ? JSON.parse(localStorage.getItem(`deleted_for_me_${currentRoom.roomId}`) || '[]') : [];
  const _starsDummy = starredTrigger;
  if (_starsDummy) {}

  const filteredMessages = visibleMessages.filter((msg) => {
    const id = msg.messageId || msg._id;
    if (deletedForMeList.includes(id)) {
      return false;
    }
    if (clearedTime && new Date(msg.timestamp) <= new Date(clearedTime)) {
      return false;
    }
    if (showChatSearch && chatSearchQuery.trim()) {
      return msg.content?.toLowerCase().includes(chatSearchQuery.toLowerCase());
    }
    return true;
  });

  return (
    <div className="chat-window fade-in">
      {/* ══ Premium Header ══ */}
      <header className="chat-header">
        {/* Left: back + avatar + name */}
        <div className="chat-user-info" onClick={() => setShowProfileDrawer(!showProfileDrawer)} style={{ cursor: 'pointer' }}>
          <button
            className="back-btn mobile-only"
            onClick={(e) => { e.stopPropagation(); onBack ? onBack() : dispatch(setCurrentRoom(null)); }}
            title="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="avatar-wrapper">
            <div
              className="chat-avatar"
              style={currentRoom.avatarColor ? { backgroundColor: currentRoom.avatarColor, color: 'white', border: 'none' } : {}}
            >
              {getRoomAvatarChar()}
            </div>
            {currentRoom.isOnline !== false && <div className="status-dot" />}
          </div>
          <div className="chat-user-details">
            <div className="chat-user-name">{getRoomDisplayName()}</div>
            <div className={`chat-status ${currentRoom.isOnline === false ? 'offline' : ''}`}>
              {currentRoom.isOnline !== false ? 'Online' : 'Offline'}
            </div>
          </div>
        </div>

        {/* Right: call buttons + search + ⋮ menu */}
        <div className="header-actions">
          {currentRoom.isDM && (
            <>
              <button className="action-btn" onClick={handleStartCall} title="Voice Call">
                <Phone size={19} />
              </button>
              <button className="action-btn" onClick={handleStartVideoCall} title="Video Call">
                <Video size={19} />
              </button>
            </>
          )}
          <button
            className={`action-btn ${showChatSearch ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setShowChatSearch(!showChatSearch); setShowHeaderMenu(false); }}
            title="Search"
          >
            <Search size={19} />
          </button>

          {/* ⋮ Overflow menu */}
          <div className="header-menu-container" onClick={(e) => e.stopPropagation()}>
            <button
              className={`action-btn ${showHeaderMenu ? 'active' : ''}`}
              onClick={() => setShowHeaderMenu(!showHeaderMenu)}
              title="More options"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            {showHeaderMenu && (
              <div className="header-dropdown-menu">
                <button className="header-menu-item" onClick={() => { setShowProfileDrawer(true); setShowHeaderMenu(false); }}>
                  <User size={15} /> View Profile
                </button>
                <button className="header-menu-item" onClick={() => { setShowChatSearch(true); setShowHeaderMenu(false); }}>
                  <Search size={15} /> Search in Chat
                </button>
                <button className="header-menu-item" onClick={() => { setShowPinned(!showPinned); setShowHeaderMenu(false); }}>
                  <Pin size={15} /> {showPinned ? 'Hide Pinned' : 'Pinned Messages'}
                </button>
                {!currentRoom.isDM && (
                  <button className="header-menu-item" onClick={() => { setShowMembers(!showMembers); setShowHeaderMenu(false); }}>
                    <Users size={15} /> Group Members
                  </button>
                )}
                <div className="header-menu-divider" />
                <button className="header-menu-item" onClick={() => {
                  const muted = localStorage.getItem(`mute_${currentRoom.roomId}`) === 'true';
                  localStorage.setItem(`mute_${currentRoom.roomId}`, muted ? 'false' : 'true');
                  setStarredTrigger(p => p + 1);
                  setShowHeaderMenu(false);
                }}>
                  <VolumeX size={15} /> {localStorage.getItem(`mute_${currentRoom.roomId}`) === 'true' ? 'Unmute' : 'Mute'}
                </button>
                <button className="header-menu-item danger-item" onClick={() => {
                  if (confirm('Clear all local messages?')) {
                    localStorage.setItem(`clear_chat_${currentRoom.roomId}`, new Date().toISOString());
                    setStarredTrigger(p => p + 1);
                  }
                  setShowHeaderMenu(false);
                }}>
                  <Trash2 size={15} /> Clear Chat
                </button>
                <button className="header-menu-item danger-item" onClick={() => {
                  if (confirm('Delete this chat for you?')) {
                    const h = JSON.parse(localStorage.getItem('hidden_rooms') || '[]');
                    if (!h.includes(currentRoom.roomId)) h.push(currentRoom.roomId);
                    localStorage.setItem('hidden_rooms', JSON.stringify(h));
                    dispatch(setCurrentRoom(null));
                  }
                  setShowHeaderMenu(false);
                }}>
                  <Ban size={15} /> Delete Chat
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Inline search bar ── */}
      {showChatSearch && (
        <div className="chat-search-bar">
          <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search in conversation…"
            value={chatSearchQuery}
            onChange={(e) => setChatSearchQuery(e.target.value)}
            autoFocus
          />
          <button onClick={() => { setShowChatSearch(false); setChatSearchQuery(''); }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Pinned messages banner ── */}
      {showPinned && currentRoom.pinnedMessages && currentRoom.pinnedMessages.length > 0 && (
        <div className="pinned-messages-list">
          <h4>📌 Pinned Messages</h4>
          {currentRoom.pinnedMessages.map((msgId: string) => {
            const msg = messages.find((m: any) => m._id === msgId || m.messageId === msgId);
            if (!msg) return <div key={msgId} className="pinned-item">Message unavailable</div>;
            return (
              <div key={msgId} className="pinned-item">
                <strong>{msg.senderName}:</strong> {msg.type === 'text' ? msg.content : `[${msg.type}]`}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Group members banner ── */}
      {showMembers && !currentRoom.isDM && (
        <div className="pinned-messages-list">
          <h4>👥 Group Members</h4>
          {currentRoom.participants.map((p: any) => (
            <div key={p._id} className="pinned-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{p.firstName} {p.lastName} {p._id === user?._id ? '(You)' : ''}</span>
              {(currentRoom as any).admins?.includes(user?._id) && p._id !== user?._id && (
                <button
                  onClick={() => handleRemoveMember(p._id)}
                  style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: 12 }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div ref={messagesContainerRef} className="messages-area">
        {isLoading && (
          <div className="loading-indicator">
            <Loader2 className="loading-spinner" />
          </div>
        )}
        
        {hasMore && !isLoading && (
          <div ref={topOfMessagesRef} className="loading-more-indicator">
            {isLoadingMore ? <Loader2 className="loading-spinner-mini spin" /> : 'Load more...'}
          </div>
        )}

        <div className="date-separator">
          <span>Today</span>
        </div>
        
        {filteredMessages.map((msg: any, idx: number) => {
          const isSentByMe = msg.senderId === user?._id;
          const isDeleted = msg.deletedForEveryone;
          const cacheKey = msg.clientMsgId || msg.messageId || msg._id;
          
          if (!isSentByMe && msg.deletedAt && !msg.deletedForEveryone) return null; // Soft deleted for other, ignore here since we only soft delete for self in UI usually

          const isRead = msg.readBy && msg.readBy.length > 0;
          const isDelivered = msg.deliveredTo && msg.deliveredTo.length > 0;

          const isSystem = msg.senderName === 'System';

          if (isSystem) {
            return (
              <div key={msg.messageId || msg._id || idx} className="system-message-bubble fade-in">
                <span className="system-message-content">{msg.content}</span>
              </div>
            );
          }

          return (
            <div 
              key={msg.messageId || msg._id || idx} 
              className={`message-bubble ${isSentByMe ? 'sent' : 'received'} ${isDeleted ? 'deleted' : ''}`}
              onContextMenu={(e) => handleContextMenuTrigger(e, msg)}
              onDoubleClick={() => toggleStarMessage(msg.messageId || msg._id)}
            >
              <div className="message-content">
                {isDeleted ? (
                  <i>This message was deleted</i>
                ) : (
                  <>
                    {msg.replyTo && (
                      <div className="replied-to-quote">
                        <div className="replied-to-sender">{msg.replyTo.senderName}</div>
                        <div className="replied-to-content">
                          {msg.replyTo.type === 'text' ? msg.replyTo.content : `[${msg.replyTo.type}]`}
                        </div>
                      </div>
                    )}
                    {msg.type === 'image' && msg.mediaUrl && (
                      failedMedia[cacheKey] ? (
                        <div className="media-error-placeholder" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.08)', borderRadius: '8px', color: '#ef4444', fontSize: '13px' }}>
                          <AlertTriangle size={16} />
                          <span>Photo unavailable</span>
                        </div>
                      ) : (msg.decryptedMediaUrl || decryptedUrls[cacheKey]) ? (
                        <div className="media-wrapper" onClick={() => setActiveImageView(msg.decryptedMediaUrl || decryptedUrls[cacheKey])} style={{ cursor: 'pointer' }}>
                          <img 
                            src={msg.decryptedMediaUrl || decryptedUrls[cacheKey]} 
                            alt="Photo" 
                            className="message-image" 
                            loading="lazy"
                            onError={() => setFailedMedia(prev => ({ ...prev, [cacheKey]: true }))}
                          />
                        </div>
                      ) : (
                        <div className="media-loading-placeholder" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: 'rgba(0, 0, 0, 0.04)', borderRadius: '8px', color: '#64748b', fontSize: '13px' }}>
                          <div className="loading-spinner-small" style={{ width: '14px', height: '14px', border: '2px solid #cbd5e1', borderTopColor: '#64748b', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                          <span>Decrypting photo...</span>
                        </div>
                      )
                    )}
                    {msg.type === 'video' && msg.mediaUrl && (
                      failedMedia[cacheKey] ? (
                        <div className="media-error-placeholder" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.08)', borderRadius: '8px', color: '#ef4444', fontSize: '13px' }}>
                          <AlertTriangle size={16} />
                          <span>Video unavailable</span>
                        </div>
                      ) : (msg.decryptedMediaUrl || decryptedUrls[cacheKey]) ? (
                        <div className="media-wrapper">
                          <video 
                            src={msg.decryptedMediaUrl || decryptedUrls[cacheKey]} 
                            controls 
                            className="message-video" 
                            onError={() => setFailedMedia(prev => ({ ...prev, [cacheKey]: true }))}
                          />
                        </div>
                      ) : (
                        <div className="media-loading-placeholder" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: 'rgba(0, 0, 0, 0.04)', borderRadius: '8px', color: '#64748b', fontSize: '13px' }}>
                          <div className="loading-spinner-small" style={{ width: '14px', height: '14px', border: '2px solid #cbd5e1', borderTopColor: '#64748b', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                          <span>Decrypting video...</span>
                        </div>
                      )
                    )}
                    {msg.type === 'audio' && msg.mediaUrl && (
                      failedMedia[cacheKey] ? (
                        <div className="media-error-placeholder" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.08)', borderRadius: '8px', color: '#ef4444', fontSize: '13px' }}>
                          <AlertTriangle size={16} />
                          <span>Audio unavailable</span>
                        </div>
                      ) : (msg.decryptedMediaUrl || decryptedUrls[cacheKey]) ? (
                        <div className="media-wrapper">
                          <audio 
                            src={msg.decryptedMediaUrl || decryptedUrls[cacheKey]} 
                            controls 
                            className="message-audio" 
                            onError={() => setFailedMedia(prev => ({ ...prev, [cacheKey]: true }))}
                          />
                        </div>
                      ) : (
                        <div className="media-loading-placeholder" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: 'rgba(0, 0, 0, 0.04)', borderRadius: '8px', color: '#64748b', fontSize: '13px' }}>
                          <div className="loading-spinner-small" style={{ width: '14px', height: '14px', border: '2px solid #cbd5e1', borderTopColor: '#64748b', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                          <span>Decrypting audio...</span>
                        </div>
                      )
                    )}
                    {msg.type === 'file' && msg.mediaUrl && (
                      (msg.decryptedMediaUrl || decryptedUrls[cacheKey]) ? (
                        <div className="message-file-attachment">
                          <FileText size={28} />
                          <div className="file-info">
                            <a 
                              href={msg.decryptedMediaUrl || decryptedUrls[cacheKey]} 
                              download={msg.mediaFilename} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="file-link"
                            >
                              {msg.mediaFilename && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(msg.mediaFilename) ? "Document" : (msg.mediaFilename || "Document")}
                            </a>
                            <span className="file-size-tag">
                              ({(msg.mediaSize / 1024 / 1024).toFixed(2)} MB)
                            </span>
                          </div>
                          <a 
                            href={msg.decryptedMediaUrl || decryptedUrls[cacheKey]} 
                            download={msg.mediaFilename}
                            className="file-download-btn"
                          >
                            <Download size={18} />
                          </a>
                        </div>
                      ) : (
                        <div className="media-loading-placeholder" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', backgroundColor: 'rgba(0, 0, 0, 0.04)', borderRadius: '8px', color: '#64748b', fontSize: '13px' }}>
                          <div className="loading-spinner-small" style={{ width: '14px', height: '14px', border: '2px solid #cbd5e1', borderTopColor: '#64748b', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                          <span>Decrypting file...</span>
                        </div>
                      )
                    )}
                    {msg.content && (
                      <div className="text-content markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {DOMPurify.sanitize(msg.content)}
                        </ReactMarkdown>
                      </div>
                    )}
                  </>
                )}
                {msg.editedAt && !isDeleted && <span className="edited-tag">(edited)</span>}
              </div>
              
              {!isDeleted && (
                <div className="message-actions-overlay">
                  <button onClick={() => handleReact(msg, '👍')} title="React 👍"><Smile size={14} /></button>
                  <button onClick={() => setReplyingTo(msg)} title="Reply"><MessageSquare size={14} /></button>
                  <button onClick={() => handlePin(msg)} title="Pin/Unpin"><Pin size={14} /></button>
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
                {isMessageStarred(msg.messageId || msg._id) && (
                  <Star size={12} color="#f59e0b" fill="#f59e0b" style={{ marginRight: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                )}
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
        {selectedFile && (
          <div className="editing-banner">
            <div className="file-preview-banner">
              {filePreviewUrl && selectedFile.type.startsWith('image/') && (
                <img src={filePreviewUrl} alt="Preview" className="preview-thumbnail" />
              )}
              {filePreviewUrl && selectedFile.type.startsWith('video/') && (
                <video src={filePreviewUrl} className="preview-thumbnail" />
              )}
              {filePreviewUrl && selectedFile.type.startsWith('audio/') && (
                <audio src={filePreviewUrl} className="preview-audio-mini" />
              )}
              <div className="file-preview-details">
                <span className="file-name">{selectedFile.name}</span>
                <span className="file-size">({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</span>
              </div>
              <button type="button" onClick={cancelFileSelection} className="cancel-edit-btn">Cancel</button>
            </div>
          </div>
        )}
        {replyingTo && (
          <div className="editing-banner">
            <div className="file-preview-banner">
              <div className="file-preview-details">
                <span className="file-name">Replying to {replyingTo.senderName}</span>
                <span className="file-size">{replyingTo.type === 'text' ? replyingTo.content : `[${replyingTo.type}]`}</span>
              </div>
              <button onClick={() => setReplyingTo(null)} className="cancel-edit-btn"><X size={16}/></button>
            </div>
          </div>
        )}
        {editingMessageId && (
          <div className="editing-banner">
            <span>Editing message...</span>
            <button onClick={cancelEdit} className="cancel-edit-btn">Cancel</button>
          </div>
        )}
        <form onSubmit={handleSendMessage} className="input-container">
          {isRecordingVoice ? (
            <VoiceRecorder 
              onSend={handleSendVoice} 
              onCancel={() => setIsRecordingVoice(false)} 
            />
          ) : (
            <>
              {/* Hidden file inputs with type-specific accept */}
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
              <input type="file" ref={imageInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleFileChange} />
              <input type="file" ref={videoInputRef} style={{ display: 'none' }} accept="video/*" onChange={handleFileChange} />

              {/* Attachment bottom-sheet */}
              <div className="attachment-popover-container">
                <button
                  type="button"
                  className={`action-btn ${showAttachmentPopover ? 'active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setShowAttachmentPopover(!showAttachmentPopover); }}
                  disabled={isUploading}
                  title="Attach"
                >
                  <Plus size={22} />
                </button>

                {showAttachmentPopover && (
                  <div className="attachment-bottom-sheet" onClick={(e) => e.stopPropagation()}>
                    <div className="attachment-sheet-row">
                      <button type="button" className="attachment-option" onClick={() => { imageInputRef.current?.setAttribute('capture', 'environment'); imageInputRef.current?.click(); setShowAttachmentPopover(false); }}>
                        <div className="attachment-icon-wrapper" style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                        </div>
                        <span>Camera</span>
                      </button>
                      <button type="button" className="attachment-option" onClick={() => { imageInputRef.current?.removeAttribute('capture'); imageInputRef.current?.click(); setShowAttachmentPopover(false); }}>
                        <div className="attachment-icon-wrapper" style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
                          <Image size={20} color="white" />
                        </div>
                        <span>Gallery</span>
                      </button>
                      <button type="button" className="attachment-option" onClick={() => { videoInputRef.current?.click(); setShowAttachmentPopover(false); }}>
                        <div className="attachment-icon-wrapper" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                        </div>
                        <span>Video</span>
                      </button>
                      <button type="button" className="attachment-option" onClick={() => { fileInputRef.current?.click(); setShowAttachmentPopover(false); }}>
                        <div className="attachment-icon-wrapper" style={{ background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' }}>
                          <File size={20} color="white" />
                        </div>
                        <span>Document</span>
                      </button>
                    </div>
                    <div className="attachment-sheet-row">
                      <button type="button" className="attachment-option" onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file'; input.accept = 'audio/*';
                        input.onchange = (e) => handleFileChange(e as any);
                        input.click();
                        setShowAttachmentPopover(false);
                      }}>
                        <div className="attachment-icon-wrapper" style={{ background: 'linear-gradient(135deg,#f43f5e,#e11d48)' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                        </div>
                        <span>Audio</span>
                      </button>
                      <button type="button" className="attachment-option" onClick={() => { setShowAttachmentPopover(false); setIsRecordingVoice(true); }}>
                        <div className="attachment-icon-wrapper" style={{ background: 'linear-gradient(135deg,#0ea5e9,#0284c7)' }}>
                          <Mic size={20} color="white" />
                        </div>
                        <span>Voice Note</span>
                      </button>
                      <button type="button" className="attachment-option" onClick={() => { setShowAttachmentPopover(false); alert('📍 Location sharing coming soon.'); }}>
                        <div className="attachment-icon-wrapper" style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)' }}>
                          <Pin size={20} color="white" />
                        </div>
                        <span>Location</span>
                      </button>
                      <button type="button" className="attachment-option" onClick={() => { setShowAttachmentPopover(false); alert('👤 Contact sharing coming soon.'); }}>
                        <div className="attachment-icon-wrapper" style={{ background: 'linear-gradient(135deg,#64748b,#475569)' }}>
                          <User size={20} color="white" />
                        </div>
                        <span>Contact</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <input 
                type="text" 
                placeholder="Write your message..." 
                value={newMessage}
                onChange={handleInputChange}
                disabled={isUploading}
              />
              <div className="input-actions">
                <button type="button" className="action-btn" onClick={() => setIsRecordingVoice(true)} disabled={isUploading} title="Record Voice Message">
                  <Mic size={20} />
                </button>
                <button type="submit" className="send-btn" disabled={(!newMessage.trim() && !selectedFile) || isUploading}>
                  {isUploading ? <Loader2 className="loading-spinner-mini" style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={18} />}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
      {activeImageView && (
        <ImageViewer 
          images={messages.filter(m => m.type === 'image' && !m.deletedForEveryone).map(m => m.decryptedMediaUrl || getMediaUrl(m.mediaUrl || ''))} 
          initialIndex={messages.filter(m => m.type === 'image' && !m.deletedForEveryone).map(m => m.decryptedMediaUrl || getMediaUrl(m.mediaUrl || '')).indexOf(activeImageView || '')} 
          onClose={() => setActiveImageView(null)} 
        />
      )}

      {/* ── Context Menu Overlay ── */}
      {contextMenuMsg && contextMenuPos && (
        <div 
          className="custom-context-menu" 
          style={{ top: `${contextMenuPos.y}px`, left: `${contextMenuPos.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Reaction Bar directly inside Context Menu */}
          <div className="context-menu-reactions" style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '6px' }}>
            {['😀', '😂', '❤️', '👍', '😍', '😭', '🙏'].map(emoji => (
              <button 
                key={emoji} 
                className="reaction-quick-emoji" 
                onClick={() => { handleReact(contextMenuMsg, emoji); setContextMenuMsg(null); }}
              >
                {emoji}
              </button>
            ))}
            <button 
              className="reaction-plus-btn" 
              onClick={() => { setShowEmojiPickerMsg(contextMenuMsg); setContextMenuMsg(null); }}
            >
              ➕
            </button>
          </div>
          <button className="context-menu-item" onClick={() => { setReplyingTo(contextMenuMsg); setContextMenuMsg(null); }}>
            <MessageSquare size={14} /> Reply
          </button>
          {contextMenuMsg.type === 'text' && (
            <button className="context-menu-item" onClick={() => { handleCopyMessage(contextMenuMsg); setContextMenuMsg(null); }}>
              <Copy size={14} /> Copy Text
            </button>
          )}
          <button className="context-menu-item" onClick={() => { setForwardMsg(contextMenuMsg); setContextMenuMsg(null); }}>
            <Forward size={14} /> Forward
          </button>
          <button className="context-menu-item" onClick={() => { toggleStarMessage(contextMenuMsg.messageId || contextMenuMsg._id); setContextMenuMsg(null); }}>
            <Star size={14} /> {isMessageStarred(contextMenuMsg.messageId || contextMenuMsg._id) ? 'Unstar' : 'Star'}
          </button>
          <button className="context-menu-item" onClick={() => { handlePin(contextMenuMsg); setContextMenuMsg(null); }}>
            <Pin size={14} /> Pin
          </button>
          {contextMenuMsg.senderId === user?._id && (
            <button className="context-menu-item" onClick={() => { handleEditClick(contextMenuMsg); setContextMenuMsg(null); }}>
              <Edit2 size={14} /> Edit
            </button>
          )}
          <button className="context-menu-item danger-item" onClick={() => { setDeleteConfirmMsg(contextMenuMsg); setContextMenuMsg(null); }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}

      {/* ── Full Emoji Picker ── */}
      {showEmojiPickerMsg && (
        <div className="emoji-search-picker" onClick={(e) => e.stopPropagation()}>
          <div className="emoji-picker-search">
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search emoji…"
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="emoji-picker-list">
            {(emojiSearch
              ? ['😀','😂','❤️','👍','😍','😭','🙏','🔥','👏','🎉','🌟','👀','💡','🚀','💯','🤔','💩','😢','🥳','😎','🤩','😡','👎','✅','❌','✨','🎈','🎁','🎂','💬','🗣️','👋','🤝','💪','🤦','🤷','🙌','👌','☝️','✌️','🤞','😇','🥺','😤','🤗','😬','🙄','😏','😒','😞','🥴','😴','🤒','🤓','🧐','🤯','🥶','🥵','😰','😱','🤮','🤧','😷','🤕','💀','👻','👾','🤖','💩','🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🌈','⭐','🌙','☀️','🌊','🏆','💎','🎯','🏠','🚗','✈️','🍕','🎵','📱','💻','🔑','🔒','❓','❗','♥️','♠️','♦️','♣️']
                  .filter(e => !emojiSearch || e.includes(emojiSearch))
              : ['😀','😂','❤️','👍','😍','😭','🙏','🔥','👏','🎉','🌟','👀','💡','🚀','💯','🤔','😢','🥳','😎','🤩','😡','👎','✅','❌','✨','🎈','🎁','💬','👋','🤝','💪','😇','🥺','😤','🤗','😬','🙄','😏','🙌','☝️','✌️','🤞','😞','🥴','😴','🤒','🤓','😰','😱','💀','👻','🤖','💩','🐶','🐱','🐻','🐼','🌈','⭐','🌙','☀️','🏆','💎','🎯','🎵','📱','💻','🔑','❓','❗']
            ).map(emoji => (
              <button
                key={emoji}
                className="emoji-picker-item"
                onClick={() => { handleReact(showEmojiPickerMsg, emoji); setShowEmojiPickerMsg(null); setEmojiSearch(''); }}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Dialog ── */}
      {deleteConfirmMsg && (
        <div className="confirm-modal-overlay" onClick={() => setDeleteConfirmMsg(null)}>
          <div className="confirm-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Message?</h3>
            <p>Would you like to delete this message for yourself, or delete it for everyone?</p>
            <div className="confirm-modal-actions">
              <button 
                className="confirm-action-btn primary" 
                onClick={() => { handleDelete(deleteConfirmMsg, false); handleDeleteForMe(deleteConfirmMsg); setDeleteConfirmMsg(null); }}
              >
                Delete for Me
              </button>
              {deleteConfirmMsg.senderId === user?._id && (
                <button 
                  className="confirm-action-btn primary" 
                  onClick={() => { handleDelete(deleteConfirmMsg, true); setDeleteConfirmMsg(null); }}
                >
                  Delete for Everyone
                </button>
              )}
              <button className="confirm-action-btn secondary" onClick={() => setDeleteConfirmMsg(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Forward Message Dialogue ── */}
      {forwardMsg && (
        <div className="confirm-modal-overlay" onClick={() => setForwardMsg(null)}>
          <div className="confirm-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Forward Message</h3>
            <p>Select a chat room to forward this message to:</p>
            <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {rooms.map((room: any) => (
                <button 
                  key={room.roomId} 
                  onClick={() => handleForwardMessage(room)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'none', textAlign: 'left', cursor: 'pointer', fontSize: '13px' }}
                >
                  {room.roomName || 'Direct Message'}
                </button>
              ))}
            </div>
            <button className="confirm-action-btn secondary" onClick={() => setForwardMsg(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ══ Profile Drawer ══ */}
      {showProfileDrawer && (
        <div className="profile-drawer">
          <div className="drawer-header">
            <button className="drawer-close-btn" onClick={() => setShowProfileDrawer(false)}>
              <ArrowLeft size={20} />
            </button>
            <h2>Contact Info</h2>
          </div>
          <div className="drawer-content">

            {/* ── Hero avatar ── */}
            <div className="drawer-hero">
              <div
                className="drawer-hero-avatar"
                style={currentRoom.avatarColor ? { backgroundColor: currentRoom.avatarColor } : {}}
              >
                {getRoomAvatarChar()}
              </div>
              <div className="drawer-hero-name">{getRoomDisplayName()}</div>
              <div className="drawer-hero-status">
                {currentRoom.isOnline !== false ? (
                  <span className="drawer-online-pill">● Online</span>
                ) : (
                  <span className="drawer-offline-pill">○ Offline</span>
                )}
              </div>
              {/* Quick action row */}
              {currentRoom.isDM && (
                <div className="drawer-quick-actions">
                  <button className="drawer-quick-btn" onClick={handleStartCall} title="Voice Call">
                    <Phone size={20} />
                    <span>Call</span>
                  </button>
                  <button className="drawer-quick-btn" onClick={handleStartVideoCall} title="Video Call">
                    <Video size={20} />
                    <span>Video</span>
                  </button>
                  <button className="drawer-quick-btn" onClick={() => setShowChatSearch(true)} title="Search">
                    <Search size={20} />
                    <span>Search</span>
                  </button>
                </div>
              )}
            </div>

            {/* ── Shared Media grid ── */}
            <div className="drawer-section">
              <div className="drawer-section-title">Shared Media</div>
              <div className="drawer-media-grid">
                {messages.filter(m => m.type === 'image' && (m.decryptedMediaUrl || m.mediaUrl) && !m.deletedForEveryone).slice(-6).map((m, i) => (
                  <div
                    key={i}
                    className="drawer-media-thumb"
                    onClick={() => setActiveImageView(m.decryptedMediaUrl || getMediaUrl(m.mediaUrl || ''))}
                  >
                    <img
                      src={m.decryptedMediaUrl || getMediaUrl(m.mediaUrl || '')}
                      alt="media"
                      loading="lazy"
                    />
                  </div>
                ))}
                {messages.filter(m => m.type === 'image' && !m.deletedForEveryone).length === 0 && (
                  <span className="drawer-empty-hint">No shared photos yet.</span>
                )}
              </div>
            </div>

            {/* ── Group members ── */}
            {!currentRoom.isDM && (
              <div className="drawer-section">
                <div className="drawer-section-title">Members ({currentRoom.participants?.length || 0})</div>
                <div className="drawer-members-list">
                  {currentRoom.participants?.map((p: any) => (
                    <div key={p._id} className="drawer-member-row">
                      <div className="room-avatar" style={{ width: 36, height: 36, fontSize: 14, flexShrink: 0 }}>
                        {p.firstName.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)' }}>
                          {p.firstName} {p.lastName} {p._id === user?._id ? '(You)' : ''}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.email}</div>
                      </div>
                      {(currentRoom as any).admins?.includes(user?._id) && p._id !== user?._id && (
                        <button
                          className="create-room-btn"
                          style={{ background: '#ef444415', color: '#ef4444' }}
                          onClick={() => handleRemoveMember(p._id)}
                          title="Remove"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Wallpaper ── */}
            <div className="drawer-section">
              <div className="drawer-section-title">Chat Wallpaper</div>
              <div className="wallpaper-grid">
                {['#f8fafc', '#efeae2', '#e5ddd5', '#d1e7dd', '#f8d7da', '#cff4fc', '#ffe69c', '#0f172a'].map(color => (
                  <div
                    key={color}
                    className={`wallpaper-color-box ${chatWallpaper === color ? 'active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => { setChatWallpaper(color); localStorage.setItem(`wallpaper_${currentRoom.roomId}`, color); }}
                  />
                ))}
              </div>
            </div>

            {/* ── Starred Messages ── */}
            <div className="drawer-section">
              <div className="drawer-section-title">Starred Messages</div>
              <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {messages.filter(m => isMessageStarred(m.messageId || m._id || '')).length > 0
                  ? messages.filter(m => isMessageStarred(m.messageId || m._id || '')).map(m => (
                    <div key={m.messageId} className="drawer-starred-row">
                      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>{m.senderName}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-main)' }}>{m.content || '[Media]'}</div>
                    </div>
                  ))
                  : <span className="drawer-empty-hint">No starred messages.</span>
                }
              </div>
            </div>

            {/* ── Actions ── */}
            <div className="drawer-section">
              <div className="drawer-options">
                <button
                  className="drawer-option-btn"
                  onClick={() => {
                    const muted = localStorage.getItem(`mute_${currentRoom.roomId}`) === 'true';
                    localStorage.setItem(`mute_${currentRoom.roomId}`, muted ? 'false' : 'true');
                    setStarredTrigger(prev => prev + 1);
                  }}
                >
                  <VolumeX size={16} />
                  {localStorage.getItem(`mute_${currentRoom.roomId}`) === 'true' ? 'Unmute Notifications' : 'Mute Notifications'}
                </button>
                <button
                  className="drawer-option-btn danger-btn"
                  onClick={() => {
                    if (confirm('Clear all local messages?')) {
                      localStorage.setItem(`clear_chat_${currentRoom.roomId}`, new Date().toISOString());
                      setStarredTrigger(prev => prev + 1);
                      setShowProfileDrawer(false);
                    }
                  }}
                >
                  <Trash2 size={16} /> Clear Chat
                </button>
                <button
                  className="drawer-option-btn danger-btn"
                  onClick={() => {
                    if (confirm('Delete this chat for you?')) {
                      const h = JSON.parse(localStorage.getItem('hidden_rooms') || '[]');
                      if (!h.includes(currentRoom.roomId)) h.push(currentRoom.roomId);
                      localStorage.setItem('hidden_rooms', JSON.stringify(h));
                      dispatch(setCurrentRoom(null));
                    }
                  }}
                >
                  <Ban size={16} /> Delete Chat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatWindow;
