import mongoose, { ClientSession } from 'mongoose';
import { Message, MessageType } from '../models/Message';
import { ChatRoom } from '../models/ChatRoom';
import { User } from '../models/User';
import { RoomEventService } from './RoomEventService';
import { RoomEvent, RoomEventType } from '../models/RoomEvent';
import { logger } from '../middleware/logger';
import crypto from 'crypto';
const uuidv4 = () => crypto.randomUUID();
import { SequenceService } from './SequenceService';
// Import removed

export class MessageService {
  /**
   * Create a message canonically within a transaction and emit a RoomEvent.
   */
  static async createMessage(
    payload: {
      clientMsgId: string;
      roomId: string;
      senderId: string;
      senderName: string;
      senderIdentityVersion: number;
      roomKeyVersion: number;
      type: MessageType;
      content?: string;
      iv?: string;
      replyTo?: string;
      encryptionVersion?: number;
      wrappedMediaKey?: string;
      mediaKeyIv?: string;
      mediaUrl?: string;
      mediaFilename?: string;
      mediaMimeType?: string;
      mediaSize?: number;
      thumbnailUrl?: string;
      mediaKey?: string;
      mediaIv?: string;
    },
    context: {
      email: string;
    }
  ) {
    try {
      return await RoomEventService.executeMutation(async (session) => {
        // 1. Re-read mutable state
        const room = await ChatRoom.findOne({ roomId: payload.roomId }).session(session);
        if (!room) throw new Error('NOT_MEMBER');

        const user = await User.findById(payload.senderId).session(session);
        if (!user) throw new Error('User not found');

        // 2. Authorize actor
        const isParticipant = room.participants.some(p => p.toString() === payload.senderId);
        if (!isParticipant) throw new Error('NOT_MEMBER');

        if (room.cryptoState === 'ROTATION_REQUIRED') {
          throw new Error('ROTATION_REQUIRED');
        }

        if (payload.senderIdentityVersion !== (user.identityVersion || 1)) {
          logger.info(`Message Creation Blocked: ${context.email} attempted to send message to room ${payload.roomId} with stale identity. (clientMsgId: ${payload.clientMsgId})`);
          throw new Error('STALE_IDENTITY');
        }

        if (payload.roomKeyVersion !== (room.roomKeyVersion || 1)) {
          logger.info(`Message Creation Blocked: ${context.email} attempted to send message to room ${payload.roomId} with stale room key. (clientMsgId: ${payload.clientMsgId})`);
          throw new Error('STALE_ROOM_KEY');
        }

        // Idempotency check via clientMsgId
        const existingMessage = await Message.findOne({ senderId: payload.senderId, clientMsgId: payload.clientMsgId })
          .populate('replyTo', 'messageId senderId senderName content type timestamp')
          .session(session);
          
        if (existingMessage) {
          return { result: existingMessage, events: [] };
        }

        // Reply-to resolution
        let replyToId: mongoose.Types.ObjectId | undefined;
        if (payload.replyTo) {
          let referenced = null;
          if (mongoose.Types.ObjectId.isValid(payload.replyTo)) {
            referenced = await Message.findById(payload.replyTo).session(session);
          } else {
            referenced = await Message.findOne({ messageId: payload.replyTo }).session(session);
          }
          if (referenced && referenced.roomId === payload.roomId) {
            replyToId = referenced._id as mongoose.Types.ObjectId;
          }
        }

        // 3. Allocate sequence
        const startSequence = await SequenceService.allocateRoomSequence(payload.roomId, 1, session);

        // 4. Domain mutation
        const message = new Message({
          messageId: uuidv4(),
          senderId: payload.senderId,
          senderName: payload.senderName,
          roomId: payload.roomId,
          type: payload.type,
          content: payload.content || '',
          iv: payload.iv,
          timestamp: new Date(),
          replyTo: replyToId,
          reactions: [],
          deliveredTo: [],
          readBy: [],
          clientMsgId: payload.clientMsgId,
          encryptionVersion: payload.encryptionVersion,
          wrappedMediaKey: payload.wrappedMediaKey,
          mediaKeyIv: payload.mediaKeyIv,
          roomKeyVersion: payload.roomKeyVersion,
          roomSequenceNumber: startSequence,
          mediaUrl: payload.mediaUrl,
          mediaFilename: payload.mediaFilename,
          mediaMimeType: payload.mediaMimeType,
          mediaSize: payload.mediaSize,
          thumbnailUrl: payload.thumbnailUrl,
          mediaKey: payload.mediaKey,
          mediaIv: payload.mediaIv,
        });

        await message.save({ session });

        // Update GridFS file metadata status to COMMITTED
        if (payload.mediaUrl && payload.mediaUrl.startsWith('/api/upload/download/')) {
          const fileId = payload.mediaUrl.split('/').pop();
          if (fileId && mongoose.Types.ObjectId.isValid(fileId)) {
            const conn = mongoose.connection;
            if (conn.db) {
              await conn.db.collection('encrypted_media.files').updateOne(
                { _id: new mongoose.Types.ObjectId(fileId) },
                { $set: { 'metadata.status': 'COMMITTED' } },
                { session }
              );
            }
          }
        }

        const populated = await message.populate('replyTo', 'messageId senderId senderName content type');

        // Update room metadata
        let previewText = payload.content || '';
        if (payload.type !== 'text') {
          previewText = `[Attachment: ${payload.type}]`;
        }
        
        const unreadIncrements: Record<string, number> = {};
        room.participants.forEach(pid => {
          if (pid.toString() !== payload.senderId) {
            unreadIncrements[`unreadCounts.${pid.toString()}`] = 1;
          }
        });
        
        await ChatRoom.updateOne(
          { roomId: payload.roomId },
          { 
            previewText, 
            lastMessage: message._id, 
            updatedAt: new Date(),
            $inc: unreadIncrements 
          },
          { session }
        );

        // 5. Construct RoomEvent
        const event = new RoomEvent({
          roomId: payload.roomId,
          sequenceNumber: startSequence,
          eventType: RoomEventType.MESSAGE_CREATED,
          eventVersion: 1,
          actorId: payload.senderId,
          payload: {
            message: populated.toObject(),
            clientMsgId: payload.clientMsgId
          }
        });

        return { result: populated, events: [event] };
      });
    } catch (error) {
      if (payload.mediaUrl && payload.mediaUrl.startsWith('/api/upload/download/')) {
        const fileId = payload.mediaUrl.split('/').pop();
        if (fileId) {
          try {
            const { GridFSService } = await import('./GridFSService');
            // Safe deletion: only delete if the current sender/uploader owns the file
            await GridFSService.deleteFileIfOwner(fileId, payload.senderId);
          } catch (deleteErr: any) {
            logger.error(`[GridFS] Failed to delete orphaned file ${fileId}: ${deleteErr.message}`);
          }
        }
      }
      throw error;
    }
  }

  static async editMessage(
    payload: { messageId: string, senderId: string, content: string, mutationId: string },
    context: { email: string }
  ) {
    return RoomEventService.executeMutation(async (session) => {
      const msg = await Message.findOne({ messageId: payload.messageId }).session(session);
      if (!msg) throw new Error('Message not found.');

      const roomId = msg.roomId;
      
      const room = await ChatRoom.findOne({ roomId }).session(session);
      if (!room) throw new Error('Room not found');

      const isParticipant = room.participants.some(p => p.toString() === payload.senderId);
      if (!isParticipant) throw new Error('NOT_MEMBER');

      if (msg.type !== 'text') throw new Error('Only text messages can be edited.');
      if (msg.senderId.toString() !== payload.senderId) throw new Error('FORBIDDEN');

      const ageMs = Date.now() - new Date(msg.timestamp).getTime();
      const EDIT_WINDOW_MS = 15 * 60 * 1000;
      if (ageMs > EDIT_WINDOW_MS) throw new Error('EDIT_WINDOW_EXCEEDED');

      await SequenceService.assertUniqueMutation(payload.mutationId, 'EDIT_MESSAGE', session, roomId, payload.senderId);

      let sanitizedContent = payload.content.replace(/<[^>]*>/g, '');
      sanitizedContent = sanitizedContent.replace(/\b(javascript|vbscript|data|blob):/gi, '');

      msg.content = sanitizedContent;
      msg.editedAt = new Date();
      await msg.save({ session });

      const startSequence = await SequenceService.allocateRoomSequence(roomId, 1, session);
      msg.roomSequenceNumber = startSequence;
      await msg.save({ session });

      const event = new RoomEvent({
        roomId,
        sequenceNumber: startSequence,
        eventType: RoomEventType.MESSAGE_EDITED,
        eventVersion: 1,
        actorId: payload.senderId,
        payload: {
          messageId: payload.messageId,
          content: sanitizedContent,
          editedAt: msg.editedAt
        }
      });

      return { result: msg, events: [event] };
    }).then(res => {
      // Small hack: RoomEventService uses the roomId passed as the first arg for the socket emit.
      // But we didn't know the roomId until inside the tx. We'll emit it here if needed, or adjust RoomEventService.
      // Actually, let's fix RoomEventService so it pulls roomId from the events array for broadcast.
      return res;
    });
  }

  static async deleteMessage(
    payload: { messageId: string, senderId: string, mutationId: string },
    context: { email: string }
  ) {
    return RoomEventService.executeMutation(async (session) => {
      const msg = await Message.findOne({ messageId: payload.messageId }).session(session);
      if (!msg) throw new Error('Message not found.');

      const roomId = msg.roomId;
      
      const room = await ChatRoom.findOne({ roomId }).session(session);
      if (!room) throw new Error('Room not found');

      const isParticipant = room.participants.some(p => p.toString() === payload.senderId);
      if (!isParticipant) throw new Error('NOT_MEMBER');

      if (msg.senderId.toString() !== payload.senderId) throw new Error('FORBIDDEN');

      await SequenceService.assertUniqueMutation(payload.mutationId, 'DELETE_MESSAGE', session, roomId, payload.senderId);

      const mediaUrlToDelete = msg.mediaUrl;
      msg.deletedForEveryone = true;
      msg.deletedAt = new Date();
      msg.content = '';
      msg.mediaUrl = undefined;
      await msg.save({ session });

      // Clean up GridFS file if it was deleted for everyone and is no longer referenced
      if (mediaUrlToDelete && mediaUrlToDelete.startsWith('/api/upload/download/')) {
        const fileId = mediaUrlToDelete.split('/').pop();
        if (fileId && mongoose.Types.ObjectId.isValid(fileId)) {
          // Check if any other message references this file
          const count = await Message.countDocuments({
            mediaUrl: mediaUrlToDelete,
            messageId: { $ne: msg.messageId }
          }).session(session);
          
          if (count === 0) {
            try {
              const { GridFSService } = await import('./GridFSService');
              // Ensure only the owner can trigger delete
              await GridFSService.deleteFileIfOwner(fileId, payload.senderId);
            } catch (deleteErr: any) {
              logger.error(`[GridFS] Failed to delete file ${fileId} during deleteMessage: ${deleteErr.message}`);
            }
          }
        }
      }

      const startSequence = await SequenceService.allocateRoomSequence(roomId, 1, session);
      msg.roomSequenceNumber = startSequence;
      await msg.save({ session });

      // Update ChatRoom preview if it was the last message
      if (room.lastMessage?.toString() === msg._id.toString()) {
        await ChatRoom.updateOne(
          { roomId },
          { previewText: 'This message was deleted.', updatedAt: new Date() },
          { session }
        );
      }

      const event = new RoomEvent({
        roomId,
        sequenceNumber: startSequence,
        eventType: RoomEventType.MESSAGE_DELETED,
        eventVersion: 1,
        actorId: payload.senderId,
        payload: {
          messageId: payload.messageId,
          deletedAt: msg.deletedAt
        }
      });

      return { result: msg, events: [event] };
    });
  }

  static async reactToMessage(
    payload: { messageId: string, senderId: string, emoji: string, mutationId: string },
    context: { email: string }
  ) {
    return RoomEventService.executeMutation(async (session) => {
      const msg = await Message.findOne({ messageId: payload.messageId }).session(session);
      if (!msg) throw new Error('Message not found.');

      const roomId = msg.roomId;
      const room = await ChatRoom.findOne({ roomId }).session(session);
      if (!room) throw new Error('Room not found');

      const isParticipant = room.participants.some(p => p.toString() === payload.senderId);
      if (!isParticipant) throw new Error('NOT_MEMBER');

      await SequenceService.assertUniqueMutation(payload.mutationId, 'REACT_MESSAGE', session, roomId, payload.senderId);

      const existingReactionIndex = msg.reactions.findIndex(
        (r) => r.userId.toString() === payload.senderId && r.emoji === payload.emoji
      );

      let action: 'added' | 'removed';
      if (existingReactionIndex > -1) {
        msg.reactions.splice(existingReactionIndex, 1);
        action = 'removed';
      } else {
        msg.reactions.push({
          emoji: payload.emoji,
          userId: new mongoose.Types.ObjectId(payload.senderId),
          createdAt: new Date(),
        });
        action = 'added';
      }
      await msg.save({ session });

      const startSequence = await SequenceService.allocateRoomSequence(roomId, 1, session);

      const event = new RoomEvent({
        roomId,
        sequenceNumber: startSequence,
        eventType: RoomEventType.REACTION_CHANGED,
        eventVersion: 1,
        actorId: payload.senderId,
        payload: {
          messageId: payload.messageId,
          emoji: payload.emoji,
          action
        }
      });

      return { result: msg, events: [event] };
    });
  }

  static async markMessagesRead(
    payload: { roomId: string, senderId: string, messageIds: string[], mutationId: string },
    context: { email: string }
  ) {
    return RoomEventService.executeMutation(async (session) => {
      const room = await ChatRoom.findOne({ roomId: payload.roomId }).session(session);
      if (!room) throw new Error('Room not found');

      const isParticipant = room.participants.some(p => p.toString() === payload.senderId);
      if (!isParticipant) throw new Error('NOT_MEMBER');

      await SequenceService.assertUniqueMutation(payload.mutationId, 'MARK_READ', session, payload.roomId, payload.senderId);

      const userObjectId = new mongoose.Types.ObjectId(payload.senderId);
      const now = new Date();

      const readUuids = payload.messageIds;
      const readQuery: any = {
        roomId: payload.roomId,
        'readBy.userId': { $ne: userObjectId },
        messageId: { $in: readUuids }
      };

      await Message.updateMany(
        readQuery,
        { $push: { readBy: { userId: userObjectId, readAt: now } } },
        { session }
      );

      await ChatRoom.updateOne(
        { roomId: payload.roomId },
        { $set: { [`unreadCounts.${payload.senderId}`]: 0 } },
        { session }
      );

      const startSequence = await SequenceService.allocateRoomSequence(payload.roomId, 1, session);

      const event = new RoomEvent({
        roomId: payload.roomId,
        sequenceNumber: startSequence,
        eventType: RoomEventType.READ_UPDATED,
        eventVersion: 1,
        actorId: payload.senderId,
        payload: {
          messageIds: readUuids,
          readAt: now
        }
      });

      return { result: true, events: [event] };
    });
  }

  static async markMessagesDelivered(
    payload: { roomId: string, senderId: string, messageIds: string[], mutationId: string },
    context: { email: string }
  ) {
    return RoomEventService.executeMutation(async (session) => {
      const room = await ChatRoom.findOne({ roomId: payload.roomId }).session(session);
      if (!room) throw new Error('Room not found');

      const isParticipant = room.participants.some(p => p.toString() === payload.senderId);
      if (!isParticipant) throw new Error('NOT_MEMBER');

      await SequenceService.assertUniqueMutation(payload.mutationId, 'MARK_DELIVERED', session, payload.roomId, payload.senderId);

      const userObjectId = new mongoose.Types.ObjectId(payload.senderId);
      const now = new Date();

      const delUuids = payload.messageIds;
      const delQuery: any = {
        roomId: payload.roomId,
        'deliveredTo.userId': { $ne: userObjectId },
        messageId: { $in: delUuids }
      };

      await Message.updateMany(
        delQuery,
        { $push: { deliveredTo: { userId: userObjectId, deliveredAt: now } } },
        { session }
      );

      const startSequence = await SequenceService.allocateRoomSequence(payload.roomId, 1, session);

      const event = new RoomEvent({
        roomId: payload.roomId,
        sequenceNumber: startSequence,
        eventType: RoomEventType.DELIVERY_UPDATED,
        eventVersion: 1,
        actorId: payload.senderId,
        payload: {
          messageIds: delUuids,
          deliveredAt: now
        }
      });

      return { result: true, events: [event] };
    });
  }

  static async pinMessage(
    payload: { roomId: string, senderId: string, messageId: string, mutationId: string },
    context: { email: string }
  ) {
    return RoomEventService.executeMutation(async (session) => {
      const room = await ChatRoom.findOne({ roomId: payload.roomId }).session(session);
      if (!room) throw new Error('Room not found');

      const isParticipant = room.participants.some(p => p.toString() === payload.senderId);
      if (!isParticipant) throw new Error('NOT_MEMBER');

      await SequenceService.assertUniqueMutation(payload.mutationId, 'PIN_MESSAGE', session, payload.roomId, payload.senderId);

      const messageObjectId = new mongoose.Types.ObjectId(payload.messageId);
      const index = room.pinnedMessages.findIndex(id => id.toString() === payload.messageId);
      
      let action: 'pinned' | 'unpinned';
      if (index > -1) {
        room.pinnedMessages.splice(index, 1);
        action = 'unpinned';
      } else {
        room.pinnedMessages.push(messageObjectId);
        action = 'pinned';
      }
      
      await room.save({ session });

      const startSequence = await SequenceService.allocateRoomSequence(payload.roomId, 1, session);

      const event = new RoomEvent({
        roomId: payload.roomId,
        sequenceNumber: startSequence,
        eventType: RoomEventType.PINNED_MESSAGES_CHANGED,
        eventVersion: 1,
        actorId: payload.senderId,
        payload: {
          messageId: payload.messageId,
          action
        }
      });

      return { result: { action, room }, events: [event] };
    });
  }
}
