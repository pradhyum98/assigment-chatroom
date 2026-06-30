import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setMessages, clearTyping } from './chatSlice';
import { clearUnreadCount, setCurrentRoom } from '../rooms/roomsSlice';
import api from '../../services/api';
import { UploadService } from '../../services/uploadService';
import { socketService } from '../../services/socket';
import { Send, Mic, Plus, CheckCheck, Check, Loader2, Edit2, Trash2, Smile, FileText, Download, Phone, Video, MessageSquare, X, Pin, ArrowLeft, Copy, Forward, Star, Image, File, VolumeX, Ban, Search } from 'lucide-react';
import { useCall } from '../calls/CallContext';
import VoiceRecorder from '../media/VoiceRecorder';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import { useCrypto } from '../../hooks/useCrypto';
import { CryptoService } from '../../services/cryptoService';
import { ImageViewer } from './ImageViewer';
import { syncManager } from '../../services/syncManager';
import './Chat.css';

const getMediaUrl = (urlPath: string) => {
  if (!urlPath) return '';
  if (urlPath.startsWith('http')) return urlPath;
  const token = localStorage.getItem('token');
  const serverUrl = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api$/, '') : 'http://localhost:5001';
  return `${serverUrl}${urlPath}?token=${token}`;
};

interface ChatWindowProps {
  onBack?: () => void;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ onBack }) => {
  const dispatch = useAppDispatch();
  const { rooms, currentRoom } = useAppSelector((state) => state.rooms);
  const { user } = useAppSelector((state) => state.auth);
  const { messages, typingUsers } = useAppSelector((state) => state.chat);
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

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollStateRef = useRef({ prevScrollHeight: 0, prevScrollTop: 0, adjustScroll: false });
  const lastRoomIdRef = useRef<string | null>(null);
  const createdObjectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const handleOutsideClick = () => {
      setContextMenuMsg(null);
      setContextMenuPos(null);
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
        const myEncKey = encryptedRoomKeys[user?._id || ''];
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
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [filePreviewUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert('File size exceeds the 10MB limit.');
      return;
    }

    setSelectedFile(file);
    if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
      const url = URL.createObjectURL(file);
      setFilePreviewUrl(url);
    } else {
      setFilePreviewUrl(null);
    }
  };

  const cancelFileSelection = () => {
    setSelectedFile(null);
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const topOfMessagesRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

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

  const handleStartCall = () => {
    if (!currentRoom || !currentRoom.isDM) {
      alert('Calls are only available in Direct Messages for now.');
      return;
    }
    const otherParticipant = currentRoom.participants?.find(
      (p: any) => p._id !== user?._id
    );
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
    const otherParticipant = currentRoom.participants?.find(
      (p: any) => p._id !== user?._id
    );
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
            
            if (msg.type !== 'text' && msg.mediaUrl && msg.mediaKey && msg.mediaIv) {
              try {
                // Fetch the encrypted file
                const fileRes = await fetch(getMediaUrl(msg.mediaUrl));
                const encryptedBlob = await fileRes.blob();
                 const objectUrl = await CryptoService.decryptFile(
                   encryptedBlob,
                   msg.mediaKey,
                   msg.mediaIv,
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
        console.error('Failed to fetch messages', err);
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
          if (msg.type !== 'text' && msg.mediaUrl && msg.mediaKey && msg.mediaIv) {
            try {
              const fileRes = await fetch(getMediaUrl(msg.mediaUrl));
              const encryptedBlob = await fileRes.blob();
               const objectUrl = await CryptoService.decryptFile(
                 encryptedBlob,
                 msg.mediaKey,
                 msg.mediaIv,
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
      
      const lastMsg = messages[messages.length - 1];
      const isSentByMe = lastMsg && lastMsg.senderId === user?._id;

      if (isSentByMe || isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }
    }
  }, [messages, currentRoom, user]);

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

      await syncManager.enqueueMessage({
        roomId: targetRoom.roomId,
        senderId: user._id,
        senderName: `${user.firstName} ${user.lastName}`,
        content: contentToSend,
        iv: ivToSend,
        clientMsgId: Math.random().toString(36).substring(7),
        type: forwardMsg.type || 'text',
        mediaUrl: forwardMsg.mediaUrl,
        mediaFilename: forwardMsg.mediaFilename,
        mediaMimeType: forwardMsg.mediaMimeType,
        mediaSize: forwardMsg.mediaSize,
        mediaKey: forwardMsg.mediaKey,
        mediaIv: forwardMsg.mediaIv,
        actionType: 'send'
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

      syncManager.enqueueMessage({
        roomId: currentRoom.roomId,
        senderId: user._id,
        senderName: `${user.firstName} ${user.lastName}`,
        content: contentToSend,
        iv: ivToSend,
        clientMsgId: editingMessageId,
        type: 'text',
        actionType: 'edit'
      });
      setEditingMessageId(null);
      setNewMessage('');
      return;
    }

    try {
      let mediaData: { url: string; filename: string; mimetype: string; size: number; type: 'image' | 'video' | 'audio' | 'file' } | null = null;

      let mediaKeyToSend: string | undefined = undefined;
      let mediaIvToSend: string | undefined = undefined;

      if (selectedFile) {
        setIsUploading(true);
        // Encrypt the file before uploading
        const { encryptedBlob, fileKeyBase64, ivBase64 } = await CryptoService.encryptFile(selectedFile);
        
        // Convert Blob to File to upload
        const encryptedFileToUpload = new (window as any).File([encryptedBlob], selectedFile.name, { type: 'application/octet-stream' }) as File;
        const uploadResult = await UploadService.uploadFileResumable(encryptedFileToUpload);
        mediaData = uploadResult.data;
        
        // Ensure type maps back since we uploaded as octet-stream
        if (selectedFile.type.startsWith('image/')) mediaData.type = 'image';
        else if (selectedFile.type.startsWith('video/')) mediaData.type = 'video';
        else if (selectedFile.type.startsWith('audio/')) mediaData.type = 'audio';
        else mediaData.type = 'file';
        
        mediaData.mimetype = selectedFile.type;

        mediaKeyToSend = fileKeyBase64;
        mediaIvToSend = ivBase64;

        cancelFileSelection();
      }

      let contentToSend = newMessage.trim();
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

      const messageData = {
        roomId: currentRoom.roomId,
        senderId: user._id,
        senderName: `${user.firstName} ${user.lastName}`,
        content: contentToSend,
        iv: ivToSend,
        clientMsgId: Math.random().toString(36).substring(7),
        replyTo: replyingTo ? (replyingTo.messageId || replyingTo._id) : undefined,
        actionType: 'send' as const,
        ...(mediaData ? {
          type: mediaData.type,
          mediaUrl: mediaData.url,
          mediaFilename: mediaData.filename,
          mediaMimeType: mediaData.mimetype,
          mediaSize: mediaData.size,
          mediaKey: mediaKeyToSend,
          mediaIv: mediaIvToSend,
        } : {
          type: 'text'
        })
      };

      syncManager.enqueueMessage(messageData);
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
      // Encrypt the file before uploading
      const file = new (window as any).File([audioBlob], 'voice-message.webm', { type: 'audio/webm' }) as File;
      const { encryptedBlob, fileKeyBase64, ivBase64 } = await CryptoService.encryptFile(file);
      
      const encryptedFileToUpload = new (window as any).File([encryptedBlob], 'voice-message.webm', { type: 'application/octet-stream' }) as File;
      const uploadResult = await UploadService.uploadFileResumable(encryptedFileToUpload);
      const mediaData = uploadResult.data;

      const messageData = {
        roomId: currentRoom.roomId,
        senderId: user._id,
        senderName: `${user.firstName} ${user.lastName}`,
        content: '',
        clientMsgId: Math.random().toString(36).substring(7),
        type: 'audio', // Treat voice notes as audio for playback UI
        mediaUrl: mediaData.url,
        mediaFilename: mediaData.filename,
        mediaMimeType: 'audio/webm',
        mediaSize: mediaData.size,
        mediaKey: fileKeyBase64,
        mediaIv: ivBase64,
        actionType: 'send' as const
      };

      syncManager.enqueueMessage(messageData);
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
    syncManager.enqueueMessage({
      roomId: currentRoom.roomId,
      senderId: user._id,
      senderName: `${user.firstName} ${user.lastName}`,
      content: '',
      clientMsgId: msg.messageId || msg._id,
      type: 'text',
      actionType: 'delete',
      deleteForEveryone: forEveryone
    });
  };

  const handleReact = (msg: any, emoji: string) => {
    if (!currentRoom || !user) return;
    syncManager.enqueueMessage({
      roomId: currentRoom.roomId,
      senderId: user._id,
      senderName: `${user.firstName} ${user.lastName}`,
      content: '',
      clientMsgId: msg.messageId || msg._id,
      type: 'reaction',
      actionType: 'react',
      reactionEmoji: emoji
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
      const encryptedRoomKeys: Record<string, string> = {};
      
      for (const p of remainingParticipants) {
        if (p.publicKey) {
          const encryptedKey = await CryptoService.encryptRoomKeyForUser(newRoomKeyBase64, p.publicKey);
          encryptedRoomKeys[p._id] = encryptedKey;
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

  const filteredMessages = messages.filter((msg) => {
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
      <header className="chat-header">
        <div className="chat-user-info" onClick={() => setShowProfileDrawer(!showProfileDrawer)} style={{ cursor: 'pointer' }}>
          <button 
            className="back-btn mobile-only" 
            onClick={(e) => { e.stopPropagation(); onBack ? onBack() : dispatch(setCurrentRoom(null)); }}
            title="Back to rooms"
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
          <button className={`action-btn ${showChatSearch ? 'active' : ''}`} onClick={() => setShowChatSearch(!showChatSearch)} title="Search Messages">
            <Search size={20} />
          </button>
          <button className={`action-btn ${showPinned ? 'active' : ''}`} onClick={() => setShowPinned(!showPinned)} title="Pinned Messages">
            <Pin size={20} />
          </button>
          {currentRoom.isDM ? (
            <>
              <button className="action-btn" onClick={handleStartCall} title="Start Voice Call">
                <Phone size={20} />
              </button>
              <button className="action-btn" onClick={handleStartVideoCall} title="Start Video Call">
                <Video size={20} />
              </button>
            </>
          ) : (
            <button className={`action-btn ${showMembers ? 'active' : ''}`} onClick={() => setShowMembers(!showMembers)} title="Group Members">
              <MessageSquare size={20} />
            </button>
          )}
        </div>
      </header>
      
      {showChatSearch && (
        <div className="chat-search-bar" style={{ padding: '8px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '8px', backgroundColor: '#f8fafc' }}>
          <input 
            type="text" 
            placeholder="Search messages..." 
            value={chatSearchQuery}
            onChange={(e) => setChatSearchQuery(e.target.value)}
            style={{ flex: 1, padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', outline: 'none', fontSize: '13px' }}
          />
          <button onClick={() => { setShowChatSearch(false); setChatSearchQuery(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
            <X size={18} />
          </button>
        </div>
      )}

      {showPinned && currentRoom.pinnedMessages && currentRoom.pinnedMessages.length > 0 && (
        <div className="pinned-messages-list">
          <h4>Pinned Messages</h4>
          {currentRoom.pinnedMessages.map((msgId: string) => {
            const msg = messages.find((m: any) => m._id === msgId || m.messageId === msgId);
            if (!msg) return <div key={msgId} className="pinned-item">Message {msgId}</div>;
            return (
              <div key={msgId} className="pinned-item">
                <strong>{msg.senderName}:</strong> {msg.type === 'text' ? msg.content : `[${msg.type}]`}
              </div>
            );
          })}
        </div>
      )}

      {showMembers && !currentRoom.isDM && (
        <div className="pinned-messages-list">
          <h4>Group Members</h4>
          {currentRoom.participants.map((p: any) => (
            <div key={p._id} className="pinned-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{p.firstName} {p.lastName} {p._id === user?._id ? '(You)' : ''}</span>
              {(currentRoom as any).admins?.includes(user?._id) && p._id !== user?._id && (
                <button 
                  onClick={() => handleRemoveMember(p._id)}
                  style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }}
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
                      <div className="media-wrapper" onClick={() => setActiveImageView(msg.decryptedMediaUrl || getMediaUrl(msg.mediaUrl))} style={{ cursor: 'pointer' }}>
                        <img 
                          src={msg.decryptedMediaUrl || getMediaUrl(msg.mediaUrl)} 
                          alt={msg.mediaFilename} 
                          className="message-image" 
                          loading="lazy"
                        />
                      </div>
                    )}
                    {msg.type === 'video' && msg.mediaUrl && (
                      <div className="media-wrapper">
                        <video 
                          src={msg.decryptedMediaUrl || getMediaUrl(msg.mediaUrl)} 
                          controls 
                          className="message-video" 
                        />
                      </div>
                    )}
                    {msg.type === 'audio' && msg.mediaUrl && (
                      <div className="media-wrapper">
                        <audio 
                          src={msg.decryptedMediaUrl || getMediaUrl(msg.mediaUrl)} 
                          controls 
                          className="message-audio" 
                        />
                      </div>
                    )}
                    {msg.type === 'file' && msg.mediaUrl && (
                      <div className="message-file-attachment">
                        <FileText size={28} />
                        <div className="file-info">
                          <a 
                            href={msg.decryptedMediaUrl || getMediaUrl(msg.mediaUrl)} 
                            download={msg.mediaFilename} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="file-link"
                          >
                            {msg.mediaFilename}
                          </a>
                          <span className="file-size-tag">
                            ({(msg.mediaSize / 1024 / 1024).toFixed(2)} MB)
                          </span>
                        </div>
                        <a 
                          href={msg.decryptedMediaUrl || getMediaUrl(msg.mediaUrl)} 
                          download={msg.mediaFilename}
                          className="file-download-btn"
                        >
                          <Download size={18} />
                        </a>
                      </div>
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
              <input 
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <div className="attachment-popover-container">
                <button type="button" className="action-btn" onClick={() => setShowAttachmentPopover(!showAttachmentPopover)} disabled={isUploading}>
                  <Plus size={22} />
                </button>
                {showAttachmentPopover && (
                  <div className="attachment-popover" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="attachment-option" onClick={() => { fileInputRef.current?.click(); setShowAttachmentPopover(false); }}>
                      <div className="attachment-icon-wrapper" style={{ backgroundColor: '#25D366' }}><Image size={18} /></div>
                      <span>Gallery</span>
                    </button>
                    <button type="button" className="attachment-option" onClick={() => { fileInputRef.current?.click(); setShowAttachmentPopover(false); }}>
                      <div className="attachment-icon-wrapper" style={{ backgroundColor: '#007AFF' }}><File size={18} /></div>
                      <span>Document</span>
                    </button>
                    <button type="button" className="attachment-option" onClick={() => { alert('Location sharing is simulated.'); setShowAttachmentPopover(false); }}>
                      <div className="attachment-icon-wrapper" style={{ backgroundColor: '#FF9500' }}><Pin size={18} /></div>
                      <span>Location</span>
                    </button>
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
        <div className="emoji-search-picker" style={{ position: 'fixed', bottom: '70px', right: '20px' }}>
          <div className="emoji-picker-search">
            <input 
              type="text" 
              placeholder="Search emoji..." 
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="emoji-picker-list">
            {['😀', '😂', '❤️', '👍', '😍', '😭', '🙏', '🔥', '👏', '🎉', '🌟', '👀', '💡', '🚀', '💯', '🤔', '💩', '😢', '🥳', '😎', '🤩', '😡', '👍', '👎', '✅', '❌', '✨', '🎈', '🎁', '🎂']
              .filter(e => emojiSearch ? e.includes(emojiSearch) : true)
              .map(emoji => (
                <button 
                  key={emoji} 
                  className="emoji-picker-item" 
                  onClick={() => { handleReact(showEmojiPickerMsg, emoji); setShowEmojiPickerMsg(null); setEmojiSearch(''); }}
                >
                  {emoji}
                </button>
              ))
            }
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

      {/* ── Profile Drawer (WhatsApp-style Right Column) ── */}
      {showProfileDrawer && (
        <div className="profile-drawer">
          <div className="drawer-header">
            <h2>Chat Info</h2>
            <button className="drawer-close-btn" onClick={() => setShowProfileDrawer(false)}>
              <X size={20} />
            </button>
          </div>
          <div className="drawer-content">
            {/* Wallpaper picker */}
            <div className="drawer-section">
              <div className="drawer-section-title">Chat Wallpaper</div>
              <div className="wallpaper-grid">
                {['#f8fafc', '#efeae2', '#e5ddd5', '#d1e7dd', '#f8d7da', '#cff4fc', '#ffe69c'].map(color => (
                  <div 
                    key={color} 
                    className={`wallpaper-color-box ${chatWallpaper === color ? 'active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => { setChatWallpaper(color); localStorage.setItem(`wallpaper_${currentRoom.roomId}`, color); }}
                  />
                ))}
              </div>
            </div>

            {/* Starred Messages */}
            <div className="drawer-section">
              <div className="drawer-section-title">Starred Messages</div>
              <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {messages.filter(m => isMessageStarred((m.messageId || m._id) || '')).length > 0 ? (
                  messages.filter(m => isMessageStarred((m.messageId || m._id) || '')).map(m => (
                    <div key={m.messageId} style={{ padding: '8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>{m.senderName}</div>
                      <div>{m.content || '[Media]'}</div>
                    </div>
                  ))
                ) : (
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>No starred messages yet.</span>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="drawer-section">
              <div className="drawer-section-title">Actions</div>
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
                    if (confirm('Clear all local messages in this conversation?')) {
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
                  onClick={async () => {
                    if (confirm('Delete this chat room?')) {
                      const hiddenRooms = JSON.parse(localStorage.getItem('hidden_rooms') || '[]');
                      if (!hiddenRooms.includes(currentRoom.roomId)) {
                        hiddenRooms.push(currentRoom.roomId);
                      }
                      localStorage.setItem('hidden_rooms', JSON.stringify(hiddenRooms));
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
