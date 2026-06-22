import { Router } from 'express';
import { upload, handleFileUpload } from '../controllers/uploadController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// POST /api/upload
router.post('/', upload.single('file'), handleFileUpload);

export default router;
