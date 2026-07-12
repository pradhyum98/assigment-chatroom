import mongoose from 'mongoose';
import { Message } from '../models/Message';
import { logger } from '../middleware/logger';

let bucket: mongoose.mongo.GridFSBucket | null = null;

/**
 * Gets or initializes the GridFS bucket for encrypted media.
 */
export const getGridFSBucket = (): mongoose.mongo.GridFSBucket => {
  if (bucket) return bucket;
  const conn = mongoose.connection;
  if (!conn.db) {
    throw new Error('Database connection is not established yet.');
  }
  bucket = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: 'encrypted_media',
  });
  return bucket;
};

export class GridFSService {
  /**
   * Uploads a file stream directly to GridFS bucket.
   * Stores the associated roomId, uploader, and status = 'PENDING' in file metadata.
   */
  public static async uploadFromStream(
    stream: NodeJS.ReadableStream,
    filename: string,
    mimeType: string,
    roomId: string,
    uploadedBy: string
  ): Promise<mongoose.Types.ObjectId> {
    const gridfsBucket = getGridFSBucket();

    return new Promise((resolve, reject) => {
      const uploadStream = gridfsBucket.openUploadStream(filename, {
        contentType: mimeType,
        metadata: {
          roomId,
          uploadedBy,
          status: 'PENDING',
        },
      });

      stream.on('error', (err) => {
        uploadStream.destroy();
        reject(err);
      });

      uploadStream.on('error', (err) => {
        reject(err);
      });

      uploadStream.on('finish', () => {
        resolve(uploadStream.id as mongoose.Types.ObjectId);
      });

      stream.pipe(uploadStream);
    });
  }

  /**
   * Opens a download stream for a GridFS file.
   * If a range is specified, it streams only the requested bytes.
   */
  public static async downloadStream(
    fileId: string,
    range?: { start: number; end: number }
  ): Promise<{
    stream: NodeJS.ReadableStream;
    length: number;
    contentType: string;
  }> {
    const gridfsBucket = getGridFSBucket();
    const objectId = new mongoose.Types.ObjectId(fileId);

    const conn = mongoose.connection;
    if (!conn.db) {
      throw new Error('Database connection is not established.');
    }

    const file = await conn.db
      .collection('encrypted_media.files')
      .findOne({ _id: objectId });

    if (!file) {
      throw new Error('File not found in GridFS');
    }

    const options: any = {};
    let length = file.length;

    if (range) {
      options.start = range.start;
      // GridFS end is exclusive, HTTP range end is inclusive
      options.end = range.end + 1;
      length = options.end - options.start;
    }

    const stream = gridfsBucket.openDownloadStream(objectId, options);
    return {
      stream,
      length,
      contentType: file.contentType || 'application/octet-stream',
    };
  }

  /**
   * Deletes a file from GridFS.
   */
  public static async deleteFile(fileId: string): Promise<void> {
    const gridfsBucket = getGridFSBucket();
    const objectId = new mongoose.Types.ObjectId(fileId);
    await gridfsBucket.delete(objectId);
  }

  /**
   * Safe deletion: checks file ownership and state before deletion.
   * Ensures MessageService cannot delete a pre-existing/shared/unowned GridFS file.
   */
  public static async deleteFileIfOwner(fileId: string, userId: string): Promise<boolean> {
    const conn = mongoose.connection;
    if (!conn.db) {
      throw new Error('Database connection is not established.');
    }

    const objectId = new mongoose.Types.ObjectId(fileId);
    const file = await conn.db.collection('encrypted_media.files').findOne({ _id: objectId });
    if (!file) {
      return false;
    }

    if (file.metadata?.uploadedBy !== userId) {
      logger.warn(`[GridFS] Prevented unauthorized delete attempt for file ${fileId} by user ${userId}`);
      return false;
    }

    await this.deleteFile(fileId);
    logger.info(`[GridFS] Safe deleted file: ${fileId} owned by user: ${userId}`);
    return true;
  }

  /**
   * Prunes orphaned media files.
   * Only deletes files that:
   * - are still in 'PENDING' status (meaning the message was never successfully sent/committed).
   * - are older than 24 hours (sufficiently safe retention window for offline queue/delayed uploads).
   */
  public static async pruneOrphanedMedia(): Promise<number> {
    logger.info('[GridFS] Starting orphaned media cleanup...');
    const conn = mongoose.connection;
    if (!conn.db) {
      logger.warn('[GridFS] Database not connected. Skipping prune.');
      return 0;
    }

    // 24 hour retention window to safely preserve in-flight, chunked, or offline-outbox uploads
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); 
    const filesCollection = conn.db.collection('encrypted_media.files');
    
    // Only target PENDING files older than 24 hours
    const files = await filesCollection
      .find({ 
        'metadata.status': 'PENDING', 
        uploadDate: { $lt: cutoff } 
      })
      .toArray();

    let prunedCount = 0;
    for (const file of files) {
      try {
        const fileIdStr = file._id.toString();
        // Double check against Message collections as safety fallback
        const count = await Message.countDocuments({
          mediaUrl: { $regex: fileIdStr },
        });

        if (count === 0) {
          await this.deleteFile(fileIdStr);
          logger.info(
            `[GridFS] Pruned orphaned pending file: ${fileIdStr} (${file.filename})`
          );
          prunedCount++;
        } else {
          // If referenced but marked PENDING, repair status to COMMITTED
          await filesCollection.updateOne(
            { _id: file._id },
            { $set: { 'metadata.status': 'COMMITTED' } }
          );
        }
      } catch (err: any) {
        logger.error(
          `[GridFS] Failed to prune file ${file._id}: ${err.message}`
        );
      }
    }

    logger.info(`[GridFS] Pruned ${prunedCount} orphaned pending file(s).`);
    return prunedCount;
  }

  /**
   * Starts a background interval to prune orphaned files.
   */
  public static startPruningScheduler(intervalMs: number = 6 * 60 * 60 * 1000) {
    const timer = setInterval(async () => {
      try {
        await this.pruneOrphanedMedia();
      } catch (err: any) {
        logger.error(`[GridFS] Pruning scheduler error: ${err.message}`);
      }
    }, intervalMs);
    
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    
    logger.info(
      `[GridFS] Orphaned media pruning scheduler started (every ${
        intervalMs / 1000 / 60
      } mins)`
    );
  }
}
