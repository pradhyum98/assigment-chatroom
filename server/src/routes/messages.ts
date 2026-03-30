import { Router } from 'express';
import { getMessagesByRoom } from '../controllers/messageController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/:roomId', authenticate, getMessagesByRoom);

export default router;
