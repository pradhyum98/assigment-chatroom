import mongoose from 'mongoose';
import { GridFSService } from '../src/services/GridFSService';
import { Message } from '../src/models/Message';
import connectDB from '../src/config/db';
import { Readable } from 'stream';
import dotenv from 'dotenv';
dotenv.config();

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('GridFSService', () => {
  let fileId: mongoose.Types.ObjectId;
  const testContent = 'Hello GridFS secure encryption!';
  const roomId = 'test-room-gridfs';
  const uploaderId = new mongoose.Types.ObjectId().toString();

  it('uploads a media stream to GridFS', async () => {
    const stream = new Readable();
    stream.push(testContent);
    stream.push(null);

    fileId = await GridFSService.uploadFromStream(
      stream,
      'test-image.png',
      'image/png',
      roomId,
      uploaderId
    );

    expect(fileId).toBeDefined();
    expect(mongoose.Types.ObjectId.isValid(fileId)).toBe(true);
  });

  it('downloads the complete uploaded media', async () => {
    const { stream, length, contentType } = await GridFSService.downloadStream(fileId.toString());
    expect(length).toBe(testContent.length);
    expect(contentType).toBe('image/png');

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const retrievedContent = Buffer.concat(chunks).toString();
    expect(retrievedContent).toBe(testContent);
  });

  it('downloads partial range media', async () => {
    const range = { start: 6, end: 11 }; // 'GridFS'
    const { stream, length } = await GridFSService.downloadStream(fileId.toString(), range);
    expect(length).toBe(6); // inclusive count: 6 to 11 is 6 bytes

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const retrievedContent = Buffer.concat(chunks).toString();
    expect(retrievedContent).toBe('GridFS');
  });

  it('prevents deletion of media by a non-owner', async () => {
    const stream = new Readable();
    stream.push('Confidential content');
    stream.push(null);

    const secretFileId = await GridFSService.uploadFromStream(
      stream,
      'secret.png',
      'image/png',
      roomId,
      uploaderId
    );

    const nonOwnerId = new mongoose.Types.ObjectId().toString();
    const deleteResult = await GridFSService.deleteFileIfOwner(secretFileId.toString(), nonOwnerId);
    expect(deleteResult).toBe(false);

    // Verify it was NOT deleted
    const { length } = await GridFSService.downloadStream(secretFileId.toString());
    expect(length).toBe(20);

    // Now delete it with the correct owner
    const deleteResultSuccess = await GridFSService.deleteFileIfOwner(secretFileId.toString(), uploaderId);
    expect(deleteResultSuccess).toBe(true);

    // Verify it IS deleted
    await expect(GridFSService.downloadStream(secretFileId.toString())).rejects.toThrow();
  });

  it('correctly reports orphaned media status and prunes it', async () => {
    // 1. Manually write a file that has no referencing message (will be orphaned)
    const tempStream = new Readable();
    tempStream.push('Orphaned contents');
    tempStream.push(null);
    const tempFileId = await GridFSService.uploadFromStream(
      tempStream,
      'orphan.png',
      'image/png',
      roomId,
      uploaderId
    );

    // 2. Mock a message that references `fileId` (not the `tempFileId` which should be pruned)
    await Message.create({
      messageId: 'msg-gridfs-test',
      senderId: new mongoose.Types.ObjectId(),
      senderName: 'Test Uploader',
      roomId,
      type: 'image',
      mediaUrl: `/api/upload/download/${fileId.toString()}`,
      timestamp: new Date(),
    });

    // 3. Since `pruneOrphanedMedia` has a 24-hour grace period, we temporarily mock/overwrite the check date
    // or just manipulate the uploadDate in MongoDB
    const conn = mongoose.connection;
    if (conn.db) {
      const filesCollection = conn.db.collection('encrypted_media.files');
      const pastDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      await filesCollection.updateOne({ _id: tempFileId }, { $set: { uploadDate: pastDate } });
      await filesCollection.updateOne({ _id: fileId }, { $set: { uploadDate: pastDate } });
    }

    // 4. Run the pruning
    const prunedCount = await GridFSService.pruneOrphanedMedia();
    expect(prunedCount).toBeGreaterThanOrEqual(1);

    // 5. Verify orphan was deleted
    await expect(GridFSService.downloadStream(tempFileId.toString())).rejects.toThrow();

    // 6. Verify referenced file still exists
    const { length } = await GridFSService.downloadStream(fileId.toString());
    expect(length).toBe(testContent.length);

    // Clean up test message and remaining file
    await Message.deleteOne({ messageId: 'msg-gridfs-test' });
    await GridFSService.deleteFile(fileId.toString());
  });
});
