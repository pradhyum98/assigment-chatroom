import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
const uuidv4 = () => crypto.randomUUID();
import { AppError } from '../middleware/errorHandler';
import { v2 as cloudinary } from 'cloudinary';

// ─── Cloudinary Configuration ──────────────────────────────────────────────────

const useCloudinary = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (useCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log('[Upload] Cloudinary storage enabled.');
} else {
  console.warn('[Upload] CLOUDINARY env vars not set — falling back to local disk storage.');
}

// ─── Helper: upload a local file path to Cloudinary ────────────────────────────

const uploadToCloudinary = (filePath: string, mimetype: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const resourceType = mimetype.startsWith('video/') ? 'video'
      : mimetype.startsWith('image/') ? 'image'
      : 'raw';

    cloudinary.uploader.upload(filePath, {
      resource_type: resourceType,
      folder: 'chatroom_uploads',
      // Store as raw since E2EE media is encrypted binary
      ...(resourceType === 'raw' ? {} : { resource_type: 'raw' }),
    }, (err, result) => {
      if (err || !result) return reject(err || new Error('Cloudinary upload returned no result'));
      resolve(result.secure_url);
    });
  });
};

// Always use raw resource type since files are E2EE encrypted blobs
const uploadRawToCloudinary = (filePath: string, publicId: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(filePath, {
      resource_type: 'raw',
      folder: 'chatroom_uploads',
      public_id: publicId,
      overwrite: true,
    }, (err, result) => {
      if (err || !result) return reject(err || new Error('Cloudinary upload returned no result'));
      resolve(result.secure_url);
    });
  });
};

// ─── Local Fallback Paths ───────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ─── Multer (memory storage for single upload, disk storage for chunked) ────────

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  // E2EE encrypted blobs
  'application/octet-stream',
];

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Invalid file type.', 400));
  }
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Memory storage for single-shot uploads (Cloudinary path)
const memoryStorage = multer.memoryStorage();

// Disk storage for chunked uploads (chunks need to be on disk)
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

export const upload = multer({
  storage: useCloudinary ? memoryStorage : diskStorage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

// ─── Single-shot Upload Endpoint ───────────────────────────────────────────────

export const handleFileUpload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) throw new AppError('No file uploaded.', 400);

    let fileUrl: string;

    if (useCloudinary && req.file.buffer) {
      // Stream buffer to Cloudinary
      const publicId = uuidv4();
      fileUrl = await new Promise<string>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'raw', folder: 'chatroom_uploads', public_id: publicId },
          (err, result) => {
            if (err || !result) return reject(err || new Error('No result'));
            resolve(result.secure_url);
          }
        );
        stream.end(req.file!.buffer);
      });
    } else {
      fileUrl = `/uploads/${req.file.filename}`;
    }

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
// Chunks are always saved to local disk, assembled, then pushed to Cloudinary

// For chunked uploads always use disk
export const chunkUpload = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_FILE_SIZE },
});

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

    fs.writeFileSync(
      path.join(chunksDir, 'metadata.json'),
      JSON.stringify({ filename, size, mimetype }),
      'utf-8'
    );

    res.status(200).json({ success: true, message: 'Upload session initiated', nextChunkIndex: 0 });
  } catch (err) {
    next(err);
  }
};

export const handleUploadStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const uploadId = req.query['uploadId'] as string;
    if (!uploadId) throw new AppError('uploadId is required.', 400);

    const chunksDir = path.join(UPLOAD_DIR, 'chunks', uploadId);
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

export const handleChunkUpload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { uploadId, chunkIndex, totalChunks } = req.body;
    if (!uploadId || chunkIndex === undefined || !totalChunks) {
      throw new AppError('Missing required chunk upload body fields.', 400);
    }
    if (!req.file) throw new AppError('Chunk file is missing in multipart upload.', 400);

    const chunksDir = path.join(UPLOAD_DIR, 'chunks', uploadId);
    if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

    const tempPath = req.file.path;
    const chunkDest = path.join(chunksDir, parseInt(chunkIndex).toString());
    fs.renameSync(tempPath, chunkDest);

    const totalVal = parseInt(totalChunks);
    const files = fs.readdirSync(chunksDir).filter((f) => f !== 'metadata.json');

    if (files.length === totalVal) {
      const metaPath = path.join(chunksDir, 'metadata.json');
      if (!fs.existsSync(metaPath)) throw new AppError('Upload session metadata missing.', 400);

      const { filename, size, mimetype } = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

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

      // Cleanup temp chunks
      fs.unlinkSync(metaPath);
      fs.rmdirSync(chunksDir);

      let fileUrl: string;
      if (useCloudinary) {
        // Wait for write stream to finish before uploading
        await new Promise<void>((resolve) => writeStream.on('finish', resolve));
        fileUrl = await uploadRawToCloudinary(destPath, safeFilename.replace(/\.[^/.]+$/, ''));
        // Remove local assembled file after Cloudinary upload
        try { fs.unlinkSync(destPath); } catch { /* ignore */ }
      } else {
        fileUrl = `/uploads/${safeFilename}`;
      }

      let type = 'file';
      if (mimetype.startsWith('image/')) type = 'image';
      else if (mimetype.startsWith('video/')) type = 'video';
      else if (mimetype.startsWith('audio/')) type = 'audio';

      res.status(200).json({
        success: true,
        message: 'File fully uploaded and assembled.',
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
