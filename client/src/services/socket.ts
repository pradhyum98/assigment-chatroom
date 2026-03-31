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
    
    this.socket = io(SOCKET_URL);
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

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

export const socketService = new SocketService();
