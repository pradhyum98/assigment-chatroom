import { Router } from 'express';
import {
  getMessagesByRoom,
  editMessage,
  deleteMessage,
  reactToMessage,
  getReadReceipts,
} from '../controllers/messageController';
import { authenticate } from '../middleware/auth';
import { validateObjectId, validateUuid } from '../middleware/validation';

const router = Router();

// All message routes require authentication
router.use(authenticate);

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
