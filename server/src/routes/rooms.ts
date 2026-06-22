import { Router } from 'express';
import { createRoom, getRooms, joinRoom, getRoomById, createOrGetDM, removeMember } from '../controllers/roomController';
import { authenticate } from '../middleware/auth';
import { validateObjectId, validateUuid } from '../middleware/validation';

const router = Router();

router.use(authenticate);

router.get('/', getRooms);
router.get('/:roomId', validateUuid('roomId'), getRoomById);
router.post('/', createRoom);
router.post('/dm/:friendId', validateObjectId('friendId'), createOrGetDM);
router.post('/:roomId/join', validateUuid('roomId'), joinRoom);
router.delete('/:roomId/members/:memberId', validateUuid('roomId'), validateObjectId('memberId'), removeMember);

export default router;
