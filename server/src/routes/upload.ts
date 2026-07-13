import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { upload, chunkUpload, handleFileUpload, handleInitiateUpload, handleUploadStatus, handleChunkUpload } from '../controllers/uploadController';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { ChatRoom } from '../models/ChatRoom';
import { GridFSService } from '../services/GridFSService';

const router = Router();

// Helper to verify room membership
const verifyRoomMembership = async (roomId: string, userId: string): Promise<boolean> => {
  const room = await ChatRoom.findOne({ roomId });
  if (!room) return false;
  return room.participants.some((p) => p.toString() === userId);
};

// All upload/download routes require authentication
router.use(authenticate);

// POST /api/upload
router.post('/', upload.single('file'), handleFileUpload);

// POST /api/upload/initiate
router.post('/initiate', handleInitiateUpload);

// GET /api/upload/status
router.get('/status', handleUploadStatus);

// POST /api/upload/chunk
router.post('/chunk', chunkUpload.single('chunk'), handleChunkUpload);

// GET /api/upload/download/:fileId
router.get('/download/:fileId', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Unauthorized', 401);

    const { fileId } = req.params;
    if (!fileId || !mongoose.Types.ObjectId.isValid(fileId)) {
      throw new AppError('Invalid or missing file ID.', 400);
    }

    const objectId = new mongoose.Types.ObjectId(fileId);
    const conn = mongoose.connection;
    if (!conn.db) {
      throw new AppError('Database connection is not established.', 500);
    }

    // Get the file details to check metadata and length
    const file = await conn.db.collection('encrypted_media.files').findOne({ _id: objectId });
    if (!file) {
      throw new AppError('Requested media file not found.', 404);
    }

    const roomId = file.metadata?.roomId;
    if (!roomId) {
      throw new AppError('Media metadata is missing room association.', 400);
    }

    // Verify the user is authorized to access this room
    const isMember = await verifyRoomMembership(roomId, userId);
    if (!isMember) {
      throw new AppError('Forbidden: You do not have access to this room.', 403);
    }

    const totalLength = file.length;
    const rangeHeader = req.headers.range;
    let range: { start: number; end: number } | undefined;

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;

      if (start >= totalLength || end >= totalLength || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${totalLength}`).end();
        return;
      }

      range = { start, end };
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLength}`);
      res.setHeader('Content-Length', end - start + 1);
    } else {
      res.status(200);
      res.setHeader('Content-Length', totalLength);
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // Retrieve and pipe the download stream
    const { stream } = await GridFSService.downloadStream(fileId, range);

    stream.on('error', (err) => {
      if (!res.headersSent) {
        next(err);
      }
    });

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

export default router;
