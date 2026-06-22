import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

class SocketService {
  private socket: Socket | null = null;

  constructor() {
    console.log('[Socket Service] Initializing with URL:', SOCKET_URL);
  }

  connect() {
    if (this.socket?.connected) {
      return this.socket;
    }
    
    const token = localStorage.getItem('token');
    this.socket = io(SOCKET_URL, {
      auth: {
        token,
      },
    });
    return this.socket;
  }

  joinRoom(roomId: string) {
    if (this.socket) {
      this.socket.emit('join_room', roomId);
    }
  }

  sendMessage(data: { roomId: string; senderId: string; senderName: string; content: string }) {
    if (this.socket) {
      this.socket.emit('send_message', data);
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

  editMessage(data: { messageId: string; roomId: string; content: string }) {
    if (this.socket) {
      this.socket.emit('edit_message', data);
    }
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
}

export const socketService = new SocketService();
