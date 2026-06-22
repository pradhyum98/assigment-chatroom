import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { searchMessages } from '../controllers/searchController';

const router = Router();

router.use(authenticate);

// Search routes
router.get('/messages', searchMessages);

export default router;
