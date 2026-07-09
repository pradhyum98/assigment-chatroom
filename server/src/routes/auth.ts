import { Router } from 'express';
import { signup, login, getMe, logout, changePassword, forgotPassword, resetPassword, refresh, logoutAll, listSessions, revokeSession, resetIdentity } from '../controllers/authController';
import { authenticate as protect } from '../middleware/auth';

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);
router.post('/logout-all', protect, logoutAll);
router.get('/sessions', protect, listSessions);
router.delete('/sessions/:sessionId', protect, revokeSession);
router.post('/reset-identity', protect, resetIdentity);
router.post('/change-password', protect, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/refresh', refresh);

export default router;
