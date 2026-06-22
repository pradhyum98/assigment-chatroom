import { Router } from 'express';
import { getIceServers } from '../controllers/callController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Route to fetch ICE servers config for WebRTC
router.get('/ice-servers', authenticate, getIceServers);

export default router;
