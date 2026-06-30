import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../middleware/errorHandler';

// ─── Multer Configuration ──────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Allowed MIME types
const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  // Videos
  'video/mp4', 'video/webm', 'video/quicktime',
  // Audio
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  // E2EE encrypted blobs
  'application/octet-stream'
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate secure random filename to prevent path traversal & collisions
    const ext = path.extname(file.originalname).toLowerCase();
    const safeFilename = `${uuidv4()}${ext}`;
    cb(null, safeFilename);
  },
});

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Invalid file type. Not allowed for security reasons.', 400));
  }
};

// 10 MB limit
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

// ─── Upload Endpoint Handler ──────────────────────────────────────────────────

export const handleFileUpload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded.', 400);
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    
    // Determine generic message type based on mimetype
    let type = 'file';
    if (req.file.mimetype.startsWith('image/')) type = 'image';
    else if (req.file.mimetype.startsWith('video/')) type = 'video';
    else if (req.file.mimetype.startsWith('audio/')) type = 'audio';

    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
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

export const handleInitiateUpload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { uploadId, filename, size, mimetype } = req.body;
    if (!uploadId || !filename || size === undefined || !mimetype) {
      throw new AppError('Missing required upload initiation parameters.', 400);
    }

    const chunksDir = path.join(UPLOAD_DIR, 'chunks', uploadId);
    if (!fs.existsSync(chunksDir)) {
      fs.mkdirSync(chunksDir, { recursive: true });
    }

    // Save upload metadata for later chunk assembly
    fs.writeFileSync(
      path.join(chunksDir, 'metadata.json'),
      JSON.stringify({ filename, size, mimetype }),
      'utf-8'
    );

    res.status(200).json({
      success: true,
      message: 'Upload session initiated',
      nextChunkIndex: 0,
    });
  } catch (err) {
    next(err);
  }
};

export const handleUploadStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const uploadId = req.query['uploadId'] as string;
    if (!uploadId) {
      throw new AppError('uploadId is required.', 400);
    }

    const chunksDir = path.join(UPLOAD_DIR, 'chunks', uploadId);
    if (fs.existsSync(chunksDir)) {
      const files = fs.readdirSync(chunksDir);
      // Determine what index files are present (integer names like 0, 1, 2...)
      const indices = files
        .map((f) => parseInt(f))
        .filter((n) => !isNaN(n))
        .sort((a, b) => a - b);
      
      // Determine the next missing chunk by checking sequential order
      let nextChunkIndex = 0;
      while (indices.includes(nextChunkIndex)) {
        nextChunkIndex++;
      }

      res.status(200).json({
        success: true,
        nextChunkIndex,
      });
    } else {
      res.status(200).json({
        success: true,
        nextChunkIndex: 0,
      });
    }
  } catch (err) {
    next(err);
  }
};

export const handleChunkUpload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { uploadId, chunkIndex, totalChunks } = req.body;
    if (!uploadId || chunkIndex === undefined || !totalChunks) {
      throw new AppError('Missing required chunk upload body fields.', 400);
    }

    if (!req.file) {
      throw new AppError('Chunk file is missing in multipart upload.', 400);
    }

    const chunksDir = path.join(UPLOAD_DIR, 'chunks', uploadId);
    if (!fs.existsSync(chunksDir)) {
      fs.mkdirSync(chunksDir, { recursive: true });
    }

    const tempPath = req.file.path;
    const chunkDest = path.join(chunksDir, parseInt(chunkIndex).toString());

    // Move file to chunks directory
    fs.renameSync(tempPath, chunkDest);

    const indexVal = parseInt(chunkIndex);
    const totalVal = parseInt(totalChunks);

    // Check if we received all chunks to trigger final file merging
    const files = fs.readdirSync(chunksDir).filter((f) => f !== 'metadata.json');
    if (files.length === totalVal) {
      // Load file metadata
      const metaPath = path.join(chunksDir, 'metadata.json');
      if (!fs.existsSync(metaPath)) {
        throw new AppError('Upload session metadata missing.', 400);
      }
      const { filename, size, mimetype } = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      const ext = path.extname(filename).toLowerCase();
      const safeFilename = `${uuidv4()}${ext}`;
      const destPath = path.join(UPLOAD_DIR, safeFilename);

      // Perform file chunk assembly (FIFO concatenation)
      const writeStream = fs.createWriteStream(destPath);
      for (let i = 0; i < totalVal; i++) {
        const chunkPath = path.join(chunksDir, i.toString());
        if (!fs.existsSync(chunkPath)) {
          throw new AppError(`Missing chunk index ${i} during merge.`, 400);
        }
        const chunkBuffer = fs.readFileSync(chunkPath);
        writeStream.write(chunkBuffer);
        fs.unlinkSync(chunkPath); // Delete chunk file
      }
      writeStream.end();
      
      // Clean up metadata and temporary chunks folder
      fs.unlinkSync(metaPath);
      fs.rmdirSync(chunksDir);

      const fileUrl = `/uploads/${safeFilename}`;
      let type = 'file';
      if (mimetype.startsWith('image/')) type = 'image';
      else if (mimetype.startsWith('video/')) type = 'video';
      else if (mimetype.startsWith('audio/')) type = 'audio';

      res.status(200).json({
        success: true,
        message: 'File fully uploaded and assembled.',
        data: {
          url: fileUrl,
          filename,
          mimetype,
          size,
          type,
        },
      });
    } else {
      res.status(200).json({
        success: true,
        message: `Chunk ${indexVal} uploaded. Progress: ${files.length}/${totalVal}`,
        chunkUploaded: indexVal,
      });
    }
  } catch (err) {
    next(err);
  }
};
