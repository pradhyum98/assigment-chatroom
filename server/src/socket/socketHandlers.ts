import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Message } from '../models/Message';
import { ChatRoom } from '../models/ChatRoom';
import { User } from '../models/User';
import { verifyToken } from '../utils/auth';
import { logger } from '../middleware/logger';
import { auditLog } from '../utils/auditLogger';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Zod schemas for incoming socket payloads ─────────────────────────────────

const incomingMessageSchema = z.object({
  roomId:        z.string().regex(uuidRegex, 'Invalid Room ID UUID format'),
  senderId:      z.string().refine((id) => mongoose.Types.ObjectId.isValid(id), 'Invalid Sender ObjectId format'),
  senderName:    z.string().min(1).max(100),
  content:       z.string().max(2000, 'Message is too long (max 2000 chars)').optional().default(''),
  replyTo:       z.string().optional(), // ObjectId of message being replied to
  clientMsgId:   z.string().optional(), // Client-side temporary ID for optimistic updates
  type:          z.enum(['text', 'image', 'video', 'audio', 'file', 'voice']).optional().default('text'),
  mediaUrl:      z.string().optional(),
  mediaFilename: z.string().optional(),
  mediaMimeType: z.string().optional(),
  mediaSize:     z.number().optional(),
  thumbnailUrl:  z.string().optional(),
}).refine((data) => {
  if (data.type === 'text' && (!data.content || data.content.trim().length === 0)) {
    return false;
  }
  if (data.type !== 'text' && !data.mediaUrl) {
    return false;
  }
  return true;
}, {
  message: 'Text messages cannot be empty, and media messages must have a mediaUrl',
  path: ['content']
});

const typingSchema = z.object({
  roomId:   z.string().regex(uuidRegex, 'Invalid Room ID UUID format'),
  isTyping: z.boolean(),
});

const markReadSchema = z.object({
  roomId:      z.string().regex(uuidRegex, 'Invalid Room ID format'),
  messageIds:  z.array(z.string()).min(1).max(100),
});

const reactSchema = z.object({
  messageId: z.string().refine((id) => mongoose.Types.ObjectId.isValid(id), 'Invalid message ID'),
  roomId:    z.string().regex(uuidRegex, 'Invalid Room ID format'),
  emoji:     z.string().min(1).max(10),
});

const editMsgSchema = z.object({
  messageId: z.string().refine((id) => mongoose.Types.ObjectId.isValid(id), 'Invalid message ID'),
  roomId:    z.string().regex(uuidRegex, 'Invalid Room ID format'),
  content:   z.string().min(1).max(2000),
});

const deleteMsgSchema = z.object({
  messageId:         z.string().refine((id) => mongoose.Types.ObjectId.isValid(id), 'Invalid message ID'),
  roomId:            z.string().regex(uuidRegex, 'Invalid Room ID format'),
  deleteForEveryone: z.boolean().optional().default(false),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EDIT_WINDOW_MS = 15 * 60 * 1000;

async function getRoomAndVerifyMembership(roomId: string, userId: string) {
  const room = await ChatRoom.findOne({ roomId });
  if (!room) return null;
  const isMember = room.participants.some((p) => p.toString() === userId);
  return isMember ? room : null;
}

function sanitizeContent(raw: string): string {
  let s = raw.replace(/<[^>]*>/g, '');
  s = s.replace(/\b(javascript|vbscript|data|blob):/gi, '');
  return s;
}

// ─── Main setup ───────────────────────────────────────────────────────────────

export const setupSocketHandlers = (io: Server) => {

  // ── Connection-level JWT middleware ────────────────────────────────────────
  io.use(async (socket: Socket, next) => {
    const ip = socket.handshake.address || '';
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        auditLog.invalidToken(ip, 'Missing JWT token');
        return next(new Error('Authentication required'));
      }

      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId).lean();

      if (!user) {
        auditLog.invalidToken(ip, `User not found: ${decoded.userId}`);
        return next(new Error('Account not found'));
      }

      (socket as any).user = user;
      next();
    } catch (err: any) {
      auditLog.invalidToken(ip, `JWT verification failed: ${err.message}`);
      return next(new Error('Invalid token'));
    }
  });

  // ── Connection ─────────────────────────────────────────────────────────────
  io.on('connection', async (socket: Socket) => {
    const user = (socket as any).user;
    if (!user) { socket.disconnect(true); return; }

    const userId = user._id.toString();
    logger.debug(`Secure socket connected: ${socket.id} (${user.email})`);

    // Mark user online and broadcast presence to all their rooms
    await User.updateOne({ _id: user._id }, { isOnline: true, lastSeen: new Date() });
    const userRooms = await ChatRoom.find({ participants: user._id }, { roomId: 1 }).lean();
    userRooms.forEach(({ roomId }) => {
      socket.to(roomId).emit('presence_update', {
        userId,
        isOnline: true,
        lastSeen: new Date(),
      });
    });

    // ── join_room ────────────────────────────────────────────────────────────
    socket.on('join_room', async (roomId: string) => {
      try {
        if (!roomId || typeof roomId !== 'string' || !uuidRegex.test(roomId)) {
          socket.emit('socket_error', { message: 'Invalid room ID format.' });
          return;
        }
        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) {
          auditLog.authorizationFailure(user.email, 'join_room', roomId);
          socket.emit('socket_error', { message: 'Room not found.' });
          return;
        }
        socket.join(roomId);
        logger.info(`${user.email} joined room ${roomId}`);
      } catch (err) {
        logger.error('Error in join_room:', err);
      }
    });

    // ── send_message ─────────────────────────────────────────────────────────
    socket.on('send_message', async (payload: any) => {
      try {
        const { success, data, error } = incomingMessageSchema.safeParse(payload);
        if (!success) {
          socket.emit('socket_error', { message: 'Invalid payload.' });
          return;
        }

        const {
          roomId,
          senderId,
          senderName,
          content,
          replyTo,
          clientMsgId,
          type,
          mediaUrl,
          mediaFilename,
          mediaMimeType,
          mediaSize,
          thumbnailUrl,
        } = data;

        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) {
          auditLog.authorizationFailure(user.email, 'send_message', roomId);
          socket.emit('socket_error', { message: 'Room not found.' });
          return;
        }

        // Prevent sender-ID spoofing
        if (senderId !== userId) {
          auditLog.authorizationFailure(user.email, 'send_message_spoof', roomId);
          socket.emit('socket_error', { message: 'Action not allowed.' });
          return;
        }

        // Sanitize
        const sanitizedContent = content ? sanitizeContent(content) : '';

        // Validate replyTo if provided
        let replyToId: mongoose.Types.ObjectId | undefined;
        if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
          const referenced = await Message.findById(replyTo).lean();
          if (referenced && referenced.roomId === roomId) {
            replyToId = new mongoose.Types.ObjectId(replyTo);
          }
        }

        // Persist message
        const message = await Message.create({
          messageId:   uuidv4(),
          senderId,
          senderName,
          roomId,
          type,
          content:     sanitizedContent,
          timestamp:   new Date(),
          replyTo:     replyToId,
          reactions:   [],
          deliveredTo: [],
          readBy:      [],
          mediaUrl,
          mediaFilename,
          mediaMimeType,
          mediaSize,
          thumbnailUrl,
        });

        // Populate replyTo for broadcast
        const populated = await message.populate('replyTo', 'messageId senderId senderName content type');

        // Broadcast to all room members
        io.to(roomId).emit('message_received', { ...populated.toObject(), clientMsgId });

        // Update room preview and lastMessage
        let previewText = sanitizedContent;
        if (type !== 'text') {
          previewText = `[Attachment: ${type}]`;
        }

        ChatRoom.updateOne(
          { roomId },
          {
            previewText,
            lastMessage: message._id,
            updatedAt:   new Date(),
          }
        ).catch((err) => logger.error('Failed to update room preview:', err));

        // Increment unread counts for all participants EXCEPT the sender
        const otherParticipants = room.participants
          .map((p) => p.toString())
          .filter((pid) => pid !== userId);

        const unreadIncrements: Record<string, number> = {};
        otherParticipants.forEach((pid) => {
          unreadIncrements[`unreadCounts.${pid}`] = 1;
        });
        if (Object.keys(unreadIncrements).length > 0) {
          ChatRoom.updateOne({ roomId }, { $inc: unreadIncrements })
            .catch((err) => logger.error('Failed to increment unread counts:', err));
        }

      } catch (err) {
        logger.error('Failed to process socket message:', err);
      }
    });

    // ── typing ───────────────────────────────────────────────────────────────
    socket.on('typing', async (payload: any) => {
      try {
        const { success, data } = typingSchema.safeParse(payload);
        if (!success) return;

        const { roomId, isTyping } = data;
        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) return;

        socket.to(roomId).emit('user_typing', {
          roomId,
          userId,
          userName: `${user.firstName} ${user.lastName}`,
          isTyping,
        });
      } catch (err) {
        logger.error('Failed to process typing status:', err);
      }
    });

    // ── mark_read ────────────────────────────────────────────────────────────
    socket.on('mark_read', async (payload: any) => {
      try {
        const { success, data } = markReadSchema.safeParse(payload);
        if (!success) return;

        const { roomId, messageIds } = data;
        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) return;

        const userObjectId = new mongoose.Types.ObjectId(userId);
        const now = new Date();

        // Bulk update: add read receipt only if not already present
        await Message.updateMany(
          {
            _id: { $in: messageIds.map((id: string) => new mongoose.Types.ObjectId(id)) },
            roomId,
            'readBy.userId': { $ne: userObjectId },
          },
          {
            $push: { readBy: { userId: userObjectId, readAt: now } },
          }
        );

        // Reset unread count for this user in this room
        await ChatRoom.updateOne(
          { roomId },
          { $set: { [`unreadCounts.${userId}`]: 0 } }
        );

        // Notify room of read update
        io.to(roomId).emit('messages_read', { roomId, userId, messageIds, readAt: now });

      } catch (err) {
        logger.error('Failed to process mark_read:', err);
      }
    });

    // ── mark_delivered ────────────────────────────────────────────────────────
    socket.on('mark_delivered', async (payload: any) => {
      try {
        const { success, data } = markReadSchema.safeParse(payload);
        if (!success) return;

        const { roomId, messageIds } = data;
        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) return;

        const userObjectId = new mongoose.Types.ObjectId(userId);
        const now = new Date();

        await Message.updateMany(
          {
            _id: { $in: messageIds.map((id: string) => new mongoose.Types.ObjectId(id)) },
            roomId,
            'deliveredTo.userId': { $ne: userObjectId },
          },
          {
            $push: { deliveredTo: { userId: userObjectId, deliveredAt: now } },
          }
        );

        io.to(roomId).emit('messages_delivered', { roomId, userId, messageIds, deliveredAt: now });

      } catch (err) {
        logger.error('Failed to process mark_delivered:', err);
      }
    });

    // ── message_react (via socket for instant feedback) ───────────────────────
    socket.on('react_message', async (payload: any) => {
      try {
        const { success, data } = reactSchema.safeParse(payload);
        if (!success) {
          socket.emit('socket_error', { message: 'Invalid reaction payload.' });
          return;
        }

        const { messageId, roomId, emoji } = data;
        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) {
          socket.emit('socket_error', { message: 'Room not found.' });
          return;
        }

        const msg = await Message.findById(messageId);
        if (!msg || msg.roomId !== roomId) {
          socket.emit('socket_error', { message: 'Message not found.' });
          return;
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);
        const existingIdx = msg.reactions.findIndex(
          (r) => r.userId.toString() === userId && r.emoji === emoji
        );

        if (existingIdx !== -1) {
          msg.reactions.splice(existingIdx, 1);
        } else {
          msg.reactions.push({ emoji, userId: userObjectId, createdAt: new Date() });
        }
        await msg.save();

        io.to(roomId).emit('reaction_updated', {
          messageId:   msg._id.toString(),
          reactions:   msg.reactions,
          updatedBy:   userId,
        });

      } catch (err) {
        logger.error('Failed to process react_message:', err);
      }
    });

    // ── edit_message (via socket for real-time propagation) ───────────────────
    socket.on('edit_message', async (payload: any) => {
      try {
        const { success, data } = editMsgSchema.safeParse(payload);
        if (!success) {
          socket.emit('socket_error', { message: 'Invalid edit payload.' });
          return;
        }

        const { messageId, roomId, content } = data;
        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) {
          socket.emit('socket_error', { message: 'Room not found.' });
          return;
        }

        const msg = await Message.findById(messageId);
        if (!msg || msg.roomId !== roomId) {
          socket.emit('socket_error', { message: 'Message not found.' });
          return;
        }
        if (msg.type !== 'text') {
          socket.emit('socket_error', { message: 'Only text messages can be edited.' });
          return;
        }
        if (msg.senderId.toString() !== userId) {
          auditLog.authorizationFailure(user.email, 'edit_message', messageId);
          socket.emit('socket_error', { message: 'You can only edit your own messages.' });
          return;
        }

        const ageMs = Date.now() - new Date(msg.timestamp).getTime();
        if (ageMs > EDIT_WINDOW_MS) {
          socket.emit('socket_error', { message: 'Edit window expired.' });
          return;
        }

        msg.content  = sanitizeContent(content);
        msg.editedAt = new Date();
        await msg.save();

        io.to(roomId).emit('message_edited', {
          messageId:   msg._id.toString(),
          content:     msg.content,
          editedAt:    msg.editedAt,
          roomId,
        });

      } catch (err) {
        logger.error('Failed to process edit_message:', err);
      }
    });

    // ── delete_message (via socket) ───────────────────────────────────────────
    socket.on('delete_message', async (payload: any) => {
      try {
        const { success, data } = deleteMsgSchema.safeParse(payload);
        if (!success) {
          socket.emit('socket_error', { message: 'Invalid delete payload.' });
          return;
        }

        const { messageId, roomId, deleteForEveryone } = data;
        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) {
          socket.emit('socket_error', { message: 'Room not found.' });
          return;
        }

        const msg = await Message.findById(messageId);
        if (!msg || msg.roomId !== roomId) {
          socket.emit('socket_error', { message: 'Message not found.' });
          return;
        }

        if (deleteForEveryone) {
          if (msg.senderId.toString() !== userId) {
            auditLog.authorizationFailure(user.email, 'delete_message_everyone', messageId);
            socket.emit('socket_error', { message: 'Only the sender can delete for everyone.' });
            return;
          }
          const ageMs = Date.now() - new Date(msg.timestamp).getTime();
          if (ageMs > EDIT_WINDOW_MS) {
            socket.emit('socket_error', { message: 'Delete-for-everyone window expired.' });
            return;
          }
          msg.deletedForEveryone = true;
          msg.content            = '';
        }

        msg.deletedAt = new Date();
        await msg.save();

        if (deleteForEveryone) {
          io.to(roomId).emit('message_deleted', { messageId: msg._id.toString(), roomId, deletedForEveryone: true });
        } else {
          socket.emit('message_deleted', { messageId: msg._id.toString(), roomId, deletedForEveryone: false });
        }

      } catch (err) {
        logger.error('Failed to process delete_message:', err);
      }
    });

    // ── leave_room ────────────────────────────────────────────────────────────
    socket.on('leave_room', (roomId: string) => {
      if (!roomId || typeof roomId !== 'string' || !uuidRegex.test(roomId)) return;
      socket.leave(roomId);
      logger.info(`${user.email} left room ${roomId}`);
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      logger.debug(`Socket disconnected: ${socket.id} (${user.email})`);
      const now = new Date();
      await User.updateOne({ _id: user._id }, { isOnline: false, lastSeen: now });

      // Notify all rooms this user is in
      const userRooms2 = await ChatRoom.find({ participants: user._id }, { roomId: 1 }).lean();
      userRooms2.forEach(({ roomId }) => {
        io.to(roomId).emit('presence_update', {
          userId,
          isOnline: false,
          lastSeen: now,
        });
      });
    });
  });
};
