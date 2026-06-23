import { Router } from 'express';
import { signup, login, getMe, logout, changePassword } from '../controllers/authController';
import { authenticate as protect } from '../middleware/auth';

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);
router.post('/change-password', protect, changePassword);

export default router;
