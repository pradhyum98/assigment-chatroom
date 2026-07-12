import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Readable } from 'stream';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { ChatRoom } from '../models/ChatRoom';
import { GridFSService } from '../services/GridFSService';

const uuidv4 = () => crypto.randomUUID();

// ─── Local Temp Directory for Chunks ───────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const CHUNKS_DIR = path.join(UPLOAD_DIR, 'chunks');

if (!fs.existsSync(CHUNKS_DIR)) {
  fs.mkdirSync(CHUNKS_DIR, { recursive: true });
}

// ─── Size and Type Limits ──────────────────────────────────────────────────────
const MAX_FILE_SIZE = parseInt(process.env.MAX_MEDIA_SIZE || '10485760', 10); // Default 10 MB

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/octet-stream', // E2EE encrypted blobs
];

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Invalid file type.', 400));
  }
};

// Memory storage for single-shot uploads (GridFS direct streaming)
const memoryStorage = multer.memoryStorage();

// Disk storage for temp chunk files
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

export const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

export const chunkUpload = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_FILE_SIZE },
});

// Helper: Verify user is a member of the room
const verifyRoomMembership = async (roomId: string, userId: string): Promise<boolean> => {
  const room = await ChatRoom.findOne({ roomId });
  if (!room) return false;
  return room.participants.some((p) => p.toString() === userId);
};

// ─── Single-shot Upload Endpoint ───────────────────────────────────────────────
export const handleFileUpload = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Unauthorized', 401);

    const { roomId } = req.body;
    if (!roomId) throw new AppError('roomId is required.', 400);

    const isMember = await verifyRoomMembership(roomId, userId);
    if (!isMember) throw new AppError('Forbidden: Not a room participant.', 403);

    if (!req.file) throw new AppError('No file uploaded.', 400);
    if (req.file.size > MAX_FILE_SIZE) throw new AppError('File size exceeds maximum limit.', 400);

    // Stream buffer directly to GridFS
    const bufferStream = new Readable();
    bufferStream.push(req.file.buffer);
    bufferStream.push(null);

    const fileId = await GridFSService.uploadFromStream(
      bufferStream,
      req.file.originalname,
      req.file.mimetype,
      roomId,
      userId
    );

    let type = 'file';
    if (req.file.mimetype.startsWith('image/')) type = 'image';
    else if (req.file.mimetype.startsWith('video/')) type = 'video';
    else if (req.file.mimetype.startsWith('audio/')) type = 'audio';

    const fileUrl = `/api/upload/download/${fileId.toString()}`;

    res.status(200).json({
      success: true,
      message: 'File uploaded to GridFS successfully',
      data: {
        url: fileUrl,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        type,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Chunked Resumable Upload Controllers ──────────────────────────────────────
export const handleInitiateUpload = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Unauthorized', 401);

    const { uploadId, filename, size, mimetype, roomId } = req.body;
    if (!uploadId || !filename || size === undefined || !mimetype || !roomId) {
      throw new AppError('Missing required upload initiation parameters.', 400);
    }

    if (size > MAX_FILE_SIZE) {
      throw new AppError('File size exceeds maximum limit.', 400);
    }

    const isMember = await verifyRoomMembership(roomId, userId);
    if (!isMember) throw new AppError('Forbidden: Not a room participant.', 403);

    const chunksDir = path.join(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(chunksDir)) {
      fs.mkdirSync(chunksDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(chunksDir, 'metadata.json'),
      JSON.stringify({ filename, size, mimetype, roomId }),
      'utf-8'
    );

    res.status(200).json({ success: true, message: 'Upload session initiated', nextChunkIndex: 0 });
  } catch (err) {
    next(err);
  }
};

export const handleUploadStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const uploadId = req.query['uploadId'] as string;
    if (!uploadId) throw new AppError('uploadId is required.', 400);

    const chunksDir = path.join(CHUNKS_DIR, uploadId);
    if (fs.existsSync(chunksDir)) {
      const files = fs.readdirSync(chunksDir);
      const indices = files.map((f) => parseInt(f)).filter((n) => !isNaN(n)).sort((a, b) => a - b);
      let nextChunkIndex = 0;
      while (indices.includes(nextChunkIndex)) nextChunkIndex++;
      res.status(200).json({ success: true, nextChunkIndex });
    } else {
      res.status(200).json({ success: true, nextChunkIndex: 0 });
    }
  } catch (err) {
    next(err);
  }
};

export const handleChunkUpload = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?._id?.toString();
    if (!userId) throw new AppError('Unauthorized', 401);

    const { uploadId, chunkIndex, totalChunks } = req.body;
    if (!uploadId || chunkIndex === undefined || !totalChunks) {
      throw new AppError('Missing required chunk upload body fields.', 400);
    }
    if (!req.file) throw new AppError('Chunk file is missing in multipart upload.', 400);

    const chunksDir = path.join(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(chunksDir)) {
      fs.mkdirSync(chunksDir, { recursive: true });
    }

    // Read metadata and verify authorization
    const metaPath = path.join(chunksDir, 'metadata.json');
    if (!fs.existsSync(metaPath)) throw new AppError('Upload session not found or expired.', 400);
    const { roomId, filename, mimetype, size } = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    const isMember = await verifyRoomMembership(roomId, userId);
    if (!isMember) {
      // Remove uploaded chunk file if unauthorized
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      throw new AppError('Forbidden: Not a room participant.', 403);
    }

    const tempPath = req.file.path;
    const chunkDest = path.join(chunksDir, parseInt(chunkIndex).toString());
    fs.renameSync(tempPath, chunkDest);

    const totalVal = parseInt(totalChunks);
    const files = fs.readdirSync(chunksDir).filter((f) => f !== 'metadata.json');

    if (files.length === totalVal) {
      const ext = path.extname(filename).toLowerCase();
      const safeFilename = `${uuidv4()}${ext}`;
      const destPath = path.join(UPLOAD_DIR, safeFilename);

      // Assemble chunks
      const writeStream = fs.createWriteStream(destPath);
      for (let i = 0; i < totalVal; i++) {
        const chunkPath = path.join(chunksDir, i.toString());
        if (!fs.existsSync(chunkPath)) throw new AppError(`Missing chunk ${i}.`, 400);
        writeStream.write(fs.readFileSync(chunkPath));
        fs.unlinkSync(chunkPath);
      }
      writeStream.end();

      // Wait for write stream to finish
      await new Promise<void>((resolve) => writeStream.on('finish', resolve));

      // Stream the assembled file to GridFS
      const readStream = fs.createReadStream(destPath);
      let fileId;
      try {
        fileId = await GridFSService.uploadFromStream(
          readStream,
          filename,
          mimetype,
          roomId,
          userId
        );
      } finally {
        // Always clean up the temporary files
        try { fs.unlinkSync(destPath); } catch { /* ignore */ }
        try { fs.unlinkSync(metaPath); } catch { /* ignore */ }
        try { fs.rmdirSync(chunksDir); } catch { /* ignore */ }
      }

      let type = 'file';
      if (mimetype.startsWith('image/')) type = 'image';
      else if (mimetype.startsWith('video/')) type = 'video';
      else if (mimetype.startsWith('audio/')) type = 'audio';

      const fileUrl = `/api/upload/download/${fileId.toString()}`;

      res.status(200).json({
        success: true,
        message: 'File fully uploaded and assembled to GridFS.',
        data: { url: fileUrl, filename, mimetype, size, type },
      });
    } else {
      res.status(200).json({
        success: true,
        message: `Chunk ${parseInt(chunkIndex)} uploaded. Progress: ${files.length}/${totalVal}`,
        chunkUploaded: parseInt(chunkIndex),
      });
    }
  } catch (err) {
    next(err);
  }
};
