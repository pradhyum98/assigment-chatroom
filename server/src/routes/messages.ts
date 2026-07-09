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
    const { result } = await (await import('../services/MessageService')).MessageService.pinMessage(
      {
        roomId,
        senderId: req.user!._id.toString(),
        messageId,
        mutationId: (await import('crypto')).randomUUID() // Client should ideally pass this
      },
      { email: req.user!.email }
    );
    
    res.status(200).json({ success: true, message: result.action === 'unpinned' ? 'Message unpinned' : 'Message pinned', data: { room: result.room } });
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
