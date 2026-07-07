import { Server, Socket } from 'socket.io';
import crypto from 'crypto';
const uuidv4 = () => crypto.randomUUID();
import mongoose from 'mongoose';
import { z } from 'zod';
import { Message } from '../models/Message';
import { ChatRoom } from '../models/ChatRoom';
import { User } from '../models/User';
import { verifyToken } from '../utils/auth';
import { logger } from '../middleware/logger';
import { auditLog } from '../utils/auditLogger';
import { CallLog } from '../models/CallLog';
import { sendNotificationToUser } from '../routes/notifications';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Zod schemas for incoming socket payloads ─────────────────────────────────

const incomingMessageSchema = z.object({
  roomId:            z.string().regex(uuidRegex, 'Invalid Room ID UUID format'),
  senderId:          z.string().refine((id) => mongoose.Types.ObjectId.isValid(id), 'Invalid Sender ObjectId format'),
  senderName:        z.string().min(1).max(100),
  content:           z.string().max(10000, 'Message is too long (max 10000 chars)').optional().default(''),
  iv:                z.string().optional(),
  replyTo:           z.string().optional(), // ObjectId of message being replied to
  clientMsgId:       z.string().regex(uuidRegex, 'Invalid clientMsgId UUID format'), // Required UUID
  type:              z.enum(['text', 'image', 'video', 'audio', 'file', 'voice']).optional().default('text'),
  mediaUrl:          z.string().optional(),
  mediaFilename:     z.string().optional(),
  mediaMimeType:     z.string().optional(),
  mediaSize:         z.number().optional(),
  thumbnailUrl:      z.string().optional(),
  mediaKey:          z.string().optional(),
  mediaIv:           z.string().optional(),
  encryptionVersion: z.number().optional().default(1),
  wrappedMediaKey:   z.string().optional(),
  mediaKeyIv:        z.string().optional(),
  roomKeyVersion:    z.number().optional(),
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

const isUuidOrObjectId = (id: string) => {
  return uuidRegex.test(id) || mongoose.Types.ObjectId.isValid(id);
};

const markReadSchema = z.object({
  roomId:      z.string().regex(uuidRegex, 'Invalid Room ID format'),
  messageIds:  z.array(z.string()).min(1).max(100),
});

const reactSchema = z.object({
  messageId: z.string().refine(isUuidOrObjectId, 'Invalid message ID'),
  roomId:    z.string().regex(uuidRegex, 'Invalid Room ID format'),
  emoji:     z.string().min(1).max(10),
});

const editMsgSchema = z.object({
  messageId: z.string().refine(isUuidOrObjectId, 'Invalid message ID'),
  roomId:    z.string().regex(uuidRegex, 'Invalid Room ID format'),
  content:   z.string().min(1).max(2000),
  iv:        z.string().optional(),
});

const deleteMsgSchema = z.object({
  messageId:         z.string().refine(isUuidOrObjectId, 'Invalid message ID'),
  roomId:            z.string().regex(uuidRegex, 'Invalid Room ID format'),
  deleteForEveryone: z.boolean().optional().default(false),
});

// ─── WebRTC Signaling Schemas and State Maps ──────────────────────────────────
// Supports multiple sockets per user (multiple tabs / devices)
const userSockets = new Map<string, Set<Socket>>();

/** Get any live socket for a userId (for call routing etc.) */
function getAnySocket(userId: string): Socket | undefined {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return undefined;
  return sockets.values().next().value;
}
const activeCalls = new Map<string, { roomId: string; peerId: string; role: 'caller' | 'callee', callType: 'audio' | 'video', startedAt: Date, status: 'calling' | 'connected' }>();

const callInitiateSchema = z.object({
  roomId:   z.string().regex(uuidRegex, 'Invalid Room ID format'),
  callType: z.enum(['audio', 'video']),
});

const callAcceptSchema = z.object({
  roomId: z.string().regex(uuidRegex, 'Invalid Room ID format'),
});

const callRejectSchema = z.object({
  roomId: z.string().regex(uuidRegex, 'Invalid Room ID format'),
});

const callSignalSchema = z.object({
  roomId:       z.string().regex(uuidRegex, 'Invalid Room ID format'),
  targetUserId: z.string().refine((id) => mongoose.Types.ObjectId.isValid(id), 'Invalid Target User ID'),
  signal:       z.any(),
});

const callEndSchema = z.object({
  roomId: z.string().regex(uuidRegex, 'Invalid Room ID format'),
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
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(socket);

    // Mark user online, auto-join all their rooms, and broadcast presence
    await User.updateOne({ _id: user._id }, { isOnline: true, lastSeen: new Date() });
    const userRooms = await ChatRoom.find({ participants: user._id }, { roomId: 1 }).lean();
    userRooms.forEach(({ roomId }) => {
      socket.join(roomId);
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
    socket.on('send_message', async (payload: any, callback?: any) => {
      try {
        const { success, data, error } = incomingMessageSchema.safeParse(payload);
        if (!success) {
          if (callback && typeof callback === 'function') {
            callback({
              ok: false,
              clientMsgId: payload?.clientMsgId || '',
              errorCode: 'INVALID_PAYLOAD',
              retryable: false
            });
          } else {
            socket.emit('socket_error', { message: 'Invalid payload.' });
          }
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
          iv,
          mediaUrl,
          mediaFilename,
          mediaMimeType,
          mediaSize,
          thumbnailUrl,
          mediaKey,
          mediaIv,
          encryptionVersion,
          wrappedMediaKey,
          mediaKeyIv,
          roomKeyVersion,
        } = data;

        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) {
          auditLog.authorizationFailure(user.email, 'send_message', roomId);
          if (callback && typeof callback === 'function') {
            callback({
              ok: false,
              clientMsgId,
              errorCode: 'NOT_MEMBER',
              retryable: false
            });
          } else {
            socket.emit('socket_error', { message: 'Room not found.' });
          }
          return;
        }

        // Prevent sender-ID spoofing
        if (senderId !== userId) {
          auditLog.authorizationFailure(user.email, 'send_message_spoof', roomId);
          if (callback && typeof callback === 'function') {
            callback({
              ok: false,
              clientMsgId,
              errorCode: 'FORBIDDEN',
              retryable: false
            });
          } else {
            socket.emit('socket_error', { message: 'Action not allowed.' });
          }
          return;
        }

        // Sanitize
        const sanitizedContent = content ? sanitizeContent(content) : '';

        // Validate replyTo if provided
        let replyToId: mongoose.Types.ObjectId | undefined;
        if (replyTo) {
          let referenced = null;
          if (mongoose.Types.ObjectId.isValid(replyTo)) {
            referenced = await Message.findById(replyTo).lean();
          } else {
            referenced = await Message.findOne({ messageId: replyTo }).lean();
          }
          if (referenced && referenced.roomId === roomId) {
            replyToId = referenced._id as mongoose.Types.ObjectId;
          }
        }

        // Persist message using insert-first strategy to prevent race-condition duplicates
        let message;
        try {
          message = await Message.create({
            messageId:   uuidv4(),
            senderId,
            senderName,
            roomId,
            type,
            content:     sanitizedContent,
            iv,
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
            mediaKey,
            mediaIv,
            clientMsgId,
            encryptionVersion,
            wrappedMediaKey,
            mediaKeyIv,
            roomKeyVersion,
            roomSequenceNumber: 1, // Placeholder, fully integrated in sync events (Phase 9)
          });
        } catch (err: any) {
          // Check for unique key duplicate error
          if (err.code === 11000) {
            const existingMessage = await Message.findOne({ senderId, clientMsgId })
              .populate('replyTo', 'messageId senderId senderName content type timestamp');
            if (existingMessage) {
              if (callback && typeof callback === 'function') {
                callback({
                  ok: true,
                  clientMsgId,
                  message: existingMessage.toObject()
                });
              }
              return;
            }
          }
          throw err;
        }

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

          // Dispatch push notification if user is offline
          if (!userSockets.has(pid)) {
            sendNotificationToUser(pid, {
              title: `New message from ${senderName}`,
              body: type === 'text' ? sanitizedContent : `[${type} attachment]`,
            });
          }
        });
        if (Object.keys(unreadIncrements).length > 0) {
          ChatRoom.updateOne({ roomId }, { $inc: unreadIncrements })
            .catch((err) => logger.error('Failed to increment unread counts:', err));
        }

        // Acknowledge persistence success to the client
        if (callback && typeof callback === 'function') {
          callback({
            ok: true,
            clientMsgId,
            message: populated.toObject()
          });
        }

      } catch (err) {
        logger.error('Failed to process socket message:', err);
        if (callback && typeof callback === 'function') {
          callback({
            ok: false,
            clientMsgId: payload?.clientMsgId || '',
            errorCode: 'SERVER_ERROR',
            retryable: true
          });
        }
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

        const readObjectIds: mongoose.Types.ObjectId[] = [];
        const readUuids: string[] = [];
        for (const id of messageIds) {
          if (mongoose.Types.ObjectId.isValid(id)) {
            readObjectIds.push(new mongoose.Types.ObjectId(id));
          } else {
            readUuids.push(id);
          }
        }

        const readQuery: any = {
          roomId,
          'readBy.userId': { $ne: userObjectId },
          $or: []
        };

        if (readObjectIds.length > 0) {
          readQuery.$or.push({ _id: { $in: readObjectIds } });
        }
        if (readUuids.length > 0) {
          readQuery.$or.push({ messageId: { $in: readUuids } });
        }

        if (readQuery.$or.length === 0) {
          readQuery.messageId = { $in: [] };
          delete readQuery.$or;
        } else if (readQuery.$or.length === 1) {
          const singleCond = readQuery.$or[0];
          Object.assign(readQuery, singleCond);
          delete readQuery.$or;
        }

        // Bulk update: add read receipt only if not already present
        await Message.updateMany(
          readQuery,
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

        const delObjectIds: mongoose.Types.ObjectId[] = [];
        const delUuids: string[] = [];
        for (const id of messageIds) {
          if (mongoose.Types.ObjectId.isValid(id)) {
            delObjectIds.push(new mongoose.Types.ObjectId(id));
          } else {
            delUuids.push(id);
          }
        }

        const delQuery: any = {
          roomId,
          'deliveredTo.userId': { $ne: userObjectId },
          $or: []
        };

        if (delObjectIds.length > 0) {
          delQuery.$or.push({ _id: { $in: delObjectIds } });
        }
        if (delUuids.length > 0) {
          delQuery.$or.push({ messageId: { $in: delUuids } });
        }

        if (delQuery.$or.length === 0) {
          delQuery.messageId = { $in: [] };
          delete delQuery.$or;
        } else if (delQuery.$or.length === 1) {
          const singleCond = delQuery.$or[0];
          Object.assign(delQuery, singleCond);
          delete delQuery.$or;
        }

        await Message.updateMany(
          delQuery,
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

        const msg = mongoose.Types.ObjectId.isValid(messageId)
          ? await Message.findById(messageId)
          : await Message.findOne({ messageId });
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
          messageId:   msg.messageId || msg._id.toString(),
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

        const { messageId, roomId, content, iv } = data;
        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) {
          socket.emit('socket_error', { message: 'Room not found.' });
          return;
        }

        const msg = mongoose.Types.ObjectId.isValid(messageId)
          ? await Message.findById(messageId)
          : await Message.findOne({ messageId });
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
        if (iv) {
          msg.iv = iv;
        }
        msg.editedAt = new Date();
        await msg.save();

        io.to(roomId).emit('message_edited', {
          messageId:   msg.messageId || msg._id.toString(),
          content:     msg.content,
          iv:          msg.iv,
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

        const msg = mongoose.Types.ObjectId.isValid(messageId)
          ? await Message.findById(messageId)
          : await Message.findOne({ messageId });
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
          
          // Clean up physical file if it exists and no other message is using it
          if (msg.mediaUrl) {
            try {
              const fs = require('fs');
              const path = require('path');
              // Prevent IDOR by checking if any other message still references this media URL
              const inUseCount = await Message.countDocuments({ mediaUrl: msg.mediaUrl });
              if (inUseCount <= 1) {
                // Safely extract just the filename to prevent directory traversal
                const urlObj = new URL(msg.mediaUrl, 'http://localhost');
                const filename = path.basename(decodeURIComponent(urlObj.pathname));
                
                if (filename && !filename.includes('..') && !filename.includes('/') && !filename.includes('\\')) {
                  const filePath = path.resolve(__dirname, '../../uploads', filename);
                  const uploadsDir = path.resolve(__dirname, '../../uploads');
                  
                  if (filePath.startsWith(uploadsDir) && filePath !== uploadsDir) {
                    if (fs.existsSync(filePath)) {
                      fs.unlinkSync(filePath);
                    }
                  }
                }
              }
            } catch (err) {
              logger.error('Failed to delete physical file during message deletion:', err);
            }
          }
        }

        msg.deletedAt = new Date();
        await msg.save();

        if (deleteForEveryone) {
          io.to(roomId).emit('message_deleted', { messageId: msg.messageId || msg._id.toString(), roomId, deletedForEveryone: true });
        } else {
          socket.emit('message_deleted', { messageId: msg.messageId || msg._id.toString(), roomId, deletedForEveryone: false });
        }

      } catch (err) {
        logger.error('Failed to process delete_message:', err);
      }
    });

    // ── WebRTC Signaling Listeners ───────────────────────────────────────────
    socket.on('call:initiate', async (payload: any) => {
      try {
        const { success, data } = callInitiateSchema.safeParse(payload);
        if (!success) {
          socket.emit('socket_error', { message: 'Invalid call payload.' });
          return;
        }

        const { roomId, callType } = data;
        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) {
          socket.emit('socket_error', { message: 'Room not found.' });
          return;
        }

        const peerId = room.participants
          .map((p) => p.toString())
          .find((pId) => pId !== userId);

        if (!peerId) {
          socket.emit('socket_error', { message: 'No calling peer found in this room.' });
          return;
        }

        if (activeCalls.has(userId)) {
          socket.emit('socket_error', { message: 'You are already in a call.' });
          return;
        }

        if (activeCalls.has(peerId)) {
          socket.emit('call:busy', { roomId });
          return;
        }

        activeCalls.set(userId, { roomId, peerId, role: 'caller', callType, startedAt: new Date(), status: 'calling' });
        activeCalls.set(peerId, { roomId, peerId: userId, role: 'callee', callType, startedAt: new Date(), status: 'calling' });

        const peerSocket = getAnySocket(peerId);
        if (peerSocket) {
          peerSocket.emit('call:incoming', {
            roomId,
            callerId: userId,
            callerName: `${user.firstName} ${user.lastName}`,
            callType,
          });
        } else {
          activeCalls.delete(userId);
          activeCalls.delete(peerId);
          socket.emit('call:offline', { roomId });
          
          sendNotificationToUser(peerId, {
            title: `Missed ${callType} call from ${user.firstName} ${user.lastName}`,
            body: 'You missed a call because you were offline.',
          });
        }
      } catch (err) {
        logger.error('Error in call:initiate:', err);
      }
    });

    socket.on('call:accept', async (payload: any) => {
      try {
        const { success, data } = callAcceptSchema.safeParse(payload);
        if (!success) return;

        const { roomId } = data;
        const call = activeCalls.get(userId);
        if (!call || call.roomId !== roomId || call.role !== 'callee') {
          return;
        }

        const peerSocket = getAnySocket(call.peerId);
        if (peerSocket) {
          peerSocket.emit('call:accepted', { roomId });
        }
        
        call.status = 'connected';
        call.startedAt = new Date();
        const peerCall = activeCalls.get(call.peerId);
        if (peerCall) {
          peerCall.status = 'connected';
          peerCall.startedAt = new Date();
        }
      } catch (err) {
        logger.error('Error in call:accept:', err);
      }
    });

    socket.on('call:reject', async (payload: any) => {
      try {
        const { success, data } = callRejectSchema.safeParse(payload);
        if (!success) return;

        const { roomId } = data;
        const call = activeCalls.get(userId);
        if (!call || call.roomId !== roomId) return;

        const peerSocket = getAnySocket(call.peerId);
        if (peerSocket) {
          peerSocket.emit('call:rejected', { roomId });
        }

        const callerId = call.role === 'caller' ? userId : call.peerId;
        const receiverId = call.role === 'caller' ? call.peerId : userId;

        await CallLog.create({
          roomId,
          callerId,
          receiverId,
          callType: call.callType,
          status: 'rejected',
          startedAt: call.startedAt,
          endedAt: new Date(),
          duration: 0
        });

        const systemMsg = await Message.create({
          messageId: uuidv4(),
          senderId: userId, // use rejecting user as sender or caller
          senderName: 'System',
          roomId,
          type: 'text',
          content: `📞 Missed ${call.callType} call (Rejected)`,
          timestamp: new Date()
        });
        io.to(roomId).emit('message_received', { ...systemMsg.toObject(), clientMsgId: uuidv4() });

        activeCalls.delete(userId);
        activeCalls.delete(call.peerId);
      } catch (err) {
        logger.error('Error in call:reject:', err);
      }
    });

    socket.on('call:signal', async (payload: any) => {
      try {
        const { success, data } = callSignalSchema.safeParse(payload);
        if (!success) return;

        const { roomId, targetUserId, signal } = data;
        const room = await getRoomAndVerifyMembership(roomId, userId);
        if (!room) return;

        const targetIsMember = room.participants.some((p) => p.toString() === targetUserId);
        if (!targetIsMember) return;

        const targetSocket = getAnySocket(targetUserId);
        if (targetSocket) {
          targetSocket.emit('call:signal', {
            roomId,
            senderId: userId,
            signal,
          });
        }
      } catch (err) {
        logger.error('Error in call:signal:', err);
      }
    });

    socket.on('call:end', async (payload: any) => {
      try {
        const { success, data } = callEndSchema.safeParse(payload);
        if (!success) return;

        const { roomId } = data;
        const call = activeCalls.get(userId);
        if (!call || call.roomId !== roomId) return;

        const peerSocket = getAnySocket(call.peerId);
        if (peerSocket) {
          peerSocket.emit('call:ended', { roomId });
        }

        const now = new Date();
        const duration = call.status === 'connected' ? Math.floor((now.getTime() - call.startedAt.getTime()) / 1000) : 0;
        const finalStatus = call.status === 'connected' ? 'completed' : (call.role === 'caller' ? 'cancelled' : 'missed');

        const callerId = call.role === 'caller' ? userId : call.peerId;
        const receiverId = call.role === 'caller' ? call.peerId : userId;

        await CallLog.create({
          roomId,
          callerId,
          receiverId,
          callType: call.callType,
          status: finalStatus,
          startedAt: call.startedAt,
          endedAt: now,
          duration
        });

        const msgContent = finalStatus === 'completed' 
          ? `📞 ${call.callType === 'video' ? 'Video' : 'Audio'} call ended (${duration}s)`
          : `📞 Missed ${call.callType} call`;

        const systemMsg = await Message.create({
          messageId: uuidv4(),
          senderId: userId,
          senderName: 'System',
          roomId,
          type: 'text',
          content: msgContent,
          timestamp: new Date()
        });
        io.to(roomId).emit('message_received', { ...systemMsg.toObject(), clientMsgId: uuidv4() });

        activeCalls.delete(userId);
        activeCalls.delete(call.peerId);
      } catch (err) {
        logger.error('Error in call:end:', err);
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

      // Remove just this socket from the user's set
      const socketSet = userSockets.get(userId);
      if (socketSet) {
        socketSet.delete(socket);
        if (socketSet.size === 0) {
          userSockets.delete(userId);
        }
      }

      // Only mark offline when ALL sockets for this user are gone
      const isFullyOffline = !userSockets.has(userId) || userSockets.get(userId)!.size === 0;

      const activeCall = activeCalls.get(userId);
      if (activeCall) {
        const peerSocket = getAnySocket(activeCall.peerId);
        if (peerSocket) {
          peerSocket.emit('call:ended', { roomId: activeCall.roomId });
        }
        
        const now2 = new Date();
        const duration = activeCall.status === 'connected' ? Math.floor((now2.getTime() - activeCall.startedAt.getTime()) / 1000) : 0;
        const finalStatus = activeCall.status === 'connected' ? 'completed' : 'missed';
        
        const callerId = activeCall.role === 'caller' ? userId : activeCall.peerId;
        const receiverId = activeCall.role === 'caller' ? activeCall.peerId : userId;

        await CallLog.create({
          roomId: activeCall.roomId,
          callerId,
          receiverId,
          callType: activeCall.callType,
          status: finalStatus,
          startedAt: activeCall.startedAt,
          endedAt: now2,
          duration
        }).catch(err => logger.error('Failed to log call on disconnect:', err));

        activeCalls.delete(userId);
        activeCalls.delete(activeCall.peerId);
      }

      if (isFullyOffline) {
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
      }
    });
  });
};
