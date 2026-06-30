import { Router } from 'express';
import { upload, chunkUpload, handleFileUpload, handleInitiateUpload, handleUploadStatus, handleChunkUpload } from '../controllers/uploadController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// POST /api/upload
router.post('/', upload.single('file'), handleFileUpload);

// POST /api/upload/initiate
router.post('/initiate', handleInitiateUpload);

// GET /api/upload/status
router.get('/status', handleUploadStatus);

// POST /api/upload/chunk
router.post('/chunk', chunkUpload.single('chunk'), handleChunkUpload);

export default router;
