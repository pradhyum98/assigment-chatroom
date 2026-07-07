import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

class SocketService {
  private socket: Socket | null = null;

  constructor() {
    console.log('[Socket Service] Initializing with URL:', SOCKET_URL);
  }

  connect() {
    const token = localStorage.getItem('token');
    if (!token) return null;

    if (this.socket) {
      if (this.socket.connected && (this.socket.auth as any)?.token === token) {
        return this.socket;
      }
      (this.socket.auth as any) = { token };
      this.socket.disconnect().connect();
      return this.socket;
    }

    this.socket = io(SOCKET_URL, {
      auth: {
        token,
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    return this.socket;
  }

  waitForConnection(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }
      if (!this.socket) {
        this.connect();
      }
      this.socket?.once('connect', () => {
        resolve();
      });
      // Set a fallback timeout so we don't hang startup if connection is slow
      setTimeout(() => {
        resolve();
      }, 3000);
    });
  }

  joinRoom(roomId: string) {
    if (this.socket) {
      this.socket.emit('join_room', roomId);
    }
  }

  sendMessage(data: any, callback?: (response: any) => void) {
    if (this.socket) {
      this.socket.emit('send_message', data, callback);
    }
  }

  leaveRoom(roomId: string) {
    if (this.socket) {
      this.socket.emit('leave_room', roomId);
    }
  }

  onMessageReceived(callback: (message: any) => void) {
    if (this.socket) {
      this.socket.on('message_received', callback);
    }
  }

  editMessage(data: { messageId: string; roomId: string; content: string; iv?: string }) {
    this.socket?.emit('edit_message', data);
  }

  deleteMessage(data: { messageId: string; roomId: string; deleteForEveryone: boolean }) {
    if (this.socket) {
      this.socket.emit('delete_message', data);
    }
  }

  reactToMessage(data: { messageId: string; roomId: string; emoji: string }) {
    if (this.socket) {
      this.socket.emit('react_message', data);
    }
  }

  setTyping(data: { roomId: string; isTyping: boolean }) {
    if (this.socket) {
      this.socket.emit('typing', data);
    }
  }

  markAsRead(data: { roomId: string; messageIds: string[] }) {
    if (this.socket) {
      this.socket.emit('mark_read', data);
    }
  }

  markAsDelivered(data: { roomId: string; messageIds: string[] }) {
    if (this.socket) {
      this.socket.emit('mark_delivered', data);
    }
  }

  offMessageReceived(callback: (message: any) => void) {
    if (this.socket) {
      this.socket.off('message_received', callback);
    }
  }

  offMessageEdited(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.off('message_edited', callback);
    }
  }

  offMessageDeleted(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.off('message_deleted', callback);
    }
  }

  offReactionUpdated(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.off('reaction_updated', callback);
    }
  }

  offMessagesRead(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.off('messages_read', callback);
    }
  }

  offMessagesDelivered(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.off('messages_delivered', callback);
    }
  }

  offUserTyping(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.off('user_typing', callback);
    }
  }

  offPresenceUpdate(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.off('presence_update', callback);
    }
  }

  onUserJoined(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.on('user_joined', callback);
    }
  }

  onUserLeft(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.on('user_left', callback);
    }
  }

  onPresenceUpdate(callback: (data: { userId: string; isOnline: boolean; lastSeen: string }) => void) {
    if (this.socket) {
      this.socket.on('presence_update', callback);
    }
  }

  onUserTyping(callback: (data: { roomId: string; userId: string; userName: string; isTyping: boolean }) => void) {
    if (this.socket) {
      this.socket.on('user_typing', callback);
    }
  }

  onMessageEdited(callback: (data: { messageId: string; roomId: string; content: string; editedAt: string }) => void) {
    if (this.socket) {
      this.socket.on('message_edited', callback);
    }
  }

  onMessageDeleted(callback: (data: { messageId: string; roomId: string; deletedForEveryone: boolean }) => void) {
    if (this.socket) {
      this.socket.on('message_deleted', callback);
    }
  }

  onReactionUpdated(callback: (data: { messageId: string; reactions: any[]; updatedBy: string }) => void) {
    if (this.socket) {
      this.socket.on('reaction_updated', callback);
    }
  }

  onMessagesRead(callback: (data: { roomId: string; userId: string; messageIds: string[]; readAt: string }) => void) {
    if (this.socket) {
      this.socket.on('messages_read', callback);
    }
  }

  onMessagesDelivered(callback: (data: { roomId: string; userId: string; messageIds: string[]; deliveredAt: string }) => void) {
    if (this.socket) {
      this.socket.on('messages_delivered', callback);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }

  // ── WebRTC Signaling ─────────────────────────────────────────────────────

  initiateCall(data: { roomId: string; callType: 'audio' | 'video' }) {
    if (this.socket) this.socket.emit('call:initiate', data);
  }

  acceptCall(data: { roomId: string }) {
    if (this.socket) this.socket.emit('call:accept', data);
  }

  rejectCall(data: { roomId: string }) {
    if (this.socket) this.socket.emit('call:reject', data);
  }

  sendIceCandidate(data: { roomId: string; targetUserId: string; signal: any }) {
    if (this.socket) this.socket.emit('call:signal', data);
  }

  endCall(data: { roomId: string }) {
    if (this.socket) this.socket.emit('call:end', data);
  }

  onCallIncoming(callback: (data: { roomId: string; callerId: string; callerName: string; callType: 'audio' | 'video' }) => void) {
    if (this.socket) this.socket.on('call:incoming', callback);
  }

  onCallAccepted(callback: (data: { roomId: string }) => void) {
    if (this.socket) this.socket.on('call:accepted', callback);
  }

  onCallRejected(callback: (data: { roomId: string }) => void) {
    if (this.socket) this.socket.on('call:rejected', callback);
  }

  onCallSignal(callback: (data: { roomId: string; senderId: string; signal: any }) => void) {
    if (this.socket) this.socket.on('call:signal', callback);
  }

  onCallEnded(callback: (data: { roomId: string }) => void) {
    if (this.socket) this.socket.on('call:ended', callback);
  }

  onCallBusy(callback: (data: { roomId: string }) => void) {
    if (this.socket) this.socket.on('call:busy', callback);
  }

  onCallOffline(callback: (data: { roomId: string }) => void) {
    if (this.socket) this.socket.on('call:offline', callback);
  }

  offCallEvents() {
    if (this.socket) {
      this.socket.off('call:incoming');
      this.socket.off('call:accepted');
      this.socket.off('call:rejected');
      this.socket.off('call:signal');
      this.socket.off('call:ended');
      this.socket.off('call:busy');
      this.socket.off('call:offline');
    }
  }
}

export const socketService = new SocketService();
