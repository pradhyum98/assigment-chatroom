import { Router } from 'express';
import { createRoom, getRooms, joinRoom, getRoomById } from '../controllers/roomController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/', getRooms);
router.get('/:roomId', authenticate, getRoomById);
router.post('/', authenticate, createRoom);
router.post('/:roomId/join', authenticate, joinRoom);

export default router;
