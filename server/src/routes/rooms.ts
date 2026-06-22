import { Router } from 'express';
import { createRoom, getRooms, joinRoom, getRoomById, createOrGetDM } from '../controllers/roomController';
import { authenticate } from '../middleware/auth';
import { validateObjectId, validateUuid } from '../middleware/validation';

const router = Router();

router.use(authenticate);

router.get('/', getRooms);
router.get('/:roomId', validateUuid('roomId'), getRoomById);
router.post('/', createRoom);
router.post('/dm/:friendId', validateObjectId('friendId'), createOrGetDM);
router.post('/:roomId/join', validateUuid('roomId'), joinRoom);

export default router;
