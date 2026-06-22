import { Router } from 'express';
import {
  getMessagesByRoom,
  editMessage,
  deleteMessage,
  reactToMessage,
  getReadReceipts,
} from '../controllers/messageController';
import { getLinkPreview } from '../controllers/previewController';
import { authenticate } from '../middleware/auth';
import { validateObjectId, validateUuid } from '../middleware/validation';

const router = Router();

// All message routes require authentication
router.use(authenticate);

// ── Preview links ──────────────────────────────────────────────────────────────
router.get('/preview', getLinkPreview);

// ── Pin/Unpin message ──────────────────────────────────────────────────────────
router.post('/:roomId/pin/:messageId', validateUuid('roomId'), validateObjectId('messageId'), async (req, res, next) => {
  try {
    const { roomId, messageId } = req.params;
    const { ChatRoom } = await import('../models/ChatRoom');
    const { AppError } = await import('../middleware/errorHandler');

    const room = await ChatRoom.findOne({ roomId });
    if (!room) throw new AppError('Room not found', 404);

    const isParticipant = room.participants.some(p => p.toString() === req.user!._id.toString());
    if (!isParticipant) throw new AppError('Unauthorized', 403);

    // Toggle pin status
    const messageObjectId = new (await import('mongoose')).default.Types.ObjectId(messageId);
    const index = room.pinnedMessages.findIndex(id => id.toString() === messageId);
    
    if (index > -1) {
      room.pinnedMessages.splice(index, 1);
    } else {
      room.pinnedMessages.push(messageObjectId);
    }
    
    await room.save();
    res.status(200).json({ success: true, message: index > -1 ? 'Message unpinned' : 'Message pinned', data: { room } });
  } catch (error) {
    next(error);
  }
});

// ── Retrieve messages ──────────────────────────────────────────────────────────
router.get('/:roomId', validateUuid('roomId'), getMessagesByRoom);

// ── Edit a message (sender only, within time window) ──────────────────────────
router.patch('/:messageId', validateObjectId('messageId'), editMessage);

// ── Delete a message ─────────────────────────────────────────────────────────
router.delete('/:messageId', validateObjectId('messageId'), deleteMessage);

// ── React to a message ────────────────────────────────────────────────────────
router.post('/:messageId/react', validateObjectId('messageId'), reactToMessage);

// ── Read receipts ─────────────────────────────────────────────────────────────
router.get('/:messageId/read-receipts', validateObjectId('messageId'), getReadReceipts);

export default router;
