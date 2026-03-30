import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Message } from '../models/Message';
import { ChatRoom } from '../models/ChatRoom';
import { logger } from '../middleware/logger';
import { z } from 'zod';

const incomingMessageSchema = z.object({
  roomId: z.string().min(1, 'Room ID is required'),
  senderId: z.string().min(1, 'Sender ID is required'),
  senderName: z.string().min(1, 'Sender Name is required'),
  content: z.string().min(1, 'Message cannot be empty').max(2000, 'Message is too long'),
});

/**
 * Orchestrates WebSocket events for real-time chat functionality.
 */
export const setupSocketHandlers = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    logger.debug(`Socket connected: ${socket.id}`);

    // Join a specific chatroom
    socket.on('join_room', (roomId: string) => {
      if (!roomId) return;
      socket.join(roomId);
      logger.info(`Session ${socket.id} joined room: ${roomId}`);
    });

    // Handle incoming messages
    socket.on('send_message', async (payload: any) => {
      try {
        const { success, data, error } = incomingMessageSchema.safeParse(payload);
        
        if (!success) {
          logger.warn(`Invalid message payload from ${socket.id}: ${error.errors[0].message}`);
          return;
        }

        const { roomId, senderId, senderName, content } = data;

        const message = await Message.create({
          messageId: uuidv4(),
          senderId,
          senderName,
          roomId,
          content,
          timestamp: new Date(),
        });

        // Broadcast to everyone in the room including the sender
        io.to(roomId).emit('message_received', message);
        logger.debug(`Broadcasted message from ${senderName} to room ${roomId}`);

        // Update room preview asynchronously
        ChatRoom.updateOne({ roomId }, { previewText: content }).catch(err => 
          logger.error('Failed to update room preview:', err)
        );
      } catch (err) {
        logger.error('Failed to process socket message:', err);
      }
    });

    // Handle leaving a room
    socket.on('leave_room', (roomId: string) => {
      if (!roomId) return;
      socket.leave(roomId);
      logger.info(`Session ${socket.id} left room: ${roomId}`);
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });
};
