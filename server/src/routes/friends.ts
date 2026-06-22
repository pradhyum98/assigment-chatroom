import { Router } from 'express';
import {
  searchUsers,
  sendFriendRequest,
  getPendingRequests,
  respondToRequest,
  getFriendsList,
  removeFriend,
} from '../controllers/friendsController';
import { authenticate } from '../middleware/auth';
import { validateObjectId } from '../middleware/validation';

const router = Router();

// Secure all routes with authentication
router.use(authenticate);

router.get('/search', searchUsers);
router.post('/request', sendFriendRequest);
router.get('/requests', getPendingRequests);
router.post('/requests/:id/respond', validateObjectId('id'), respondToRequest);
router.get('/list', getFriendsList);
router.post('/remove', removeFriend);

export default router;
