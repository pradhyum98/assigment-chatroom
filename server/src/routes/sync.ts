import { Router } from 'express';
import { syncRoomEvents, syncUserEvents, fullResync } from '../controllers/syncController';
import { authenticate } from '../middleware/auth';
import { validateUuid } from '../middleware/validation';

const router = Router();

router.use(authenticate);

// Room sync
router.get('/room/:roomId/full', validateUuid('roomId'), fullResync);
router.get('/room/:roomId', validateUuid('roomId'), syncRoomEvents);

// User sync
router.get('/user', syncUserEvents);

export default router;
