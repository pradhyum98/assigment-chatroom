import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateUuid, validateObjectId } from '../middleware/validation';
import {
  addMembers,
  kickMember,
  leaveRoom,
  promoteAdmin,
  demoteAdmin,
  updateRoom
} from '../controllers/groupController';

const router = Router();

router.use(authenticate);

// Group management routes
router.post('/:roomId/members', validateUuid('roomId'), addMembers);
router.delete('/:roomId/members/:userId', validateUuid('roomId'), validateObjectId('userId'), kickMember);
router.delete('/:roomId/leave', validateUuid('roomId'), leaveRoom);
router.post('/:roomId/admins', validateUuid('roomId'), promoteAdmin);
router.delete('/:roomId/admins/:userId', validateUuid('roomId'), validateObjectId('userId'), demoteAdmin);
router.patch('/:roomId', validateUuid('roomId'), updateRoom);

export default router;
