import { Router } from 'express';
import { getCallLogs } from '../controllers/callController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Route to fetch call logs for a room
router.get('/:roomId/calls', authenticate, getCallLogs);

export default router;
