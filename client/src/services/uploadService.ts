import api from './api';
import localDb from './indexedDb';

const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MB chunks

export class UploadService {
  /**
   * Generates a deterministic unique hash/id for a given file
   */
  private static getFileId(file: File): string {
    return `${file.name}-${file.size}-${file.lastModified}`;
  }

  /**
   * Uploads a file in chunks, supporting resumption from last successful chunk.
   */
  static async uploadFileResumable(
    file: File,
    roomId: string,
    onProgress?: (pct: number) => void
  ): Promise<{
    success: boolean;
    data: {
      url: string;
      filename: string;
      mimetype: string;
      size: number;
      type: 'image' | 'video' | 'audio' | 'file';
    };
  }> {
    const uploadId = this.getFileId(file);
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    let nextChunkIndex = 0;

    try {
      // 1. Query status from backend to see if some chunks were already received
      const statusRes = await api.get(`/upload/status?uploadId=${uploadId}`);
      if (statusRes.data && typeof statusRes.data.nextChunkIndex === 'number') {
        nextChunkIndex = statusRes.data.nextChunkIndex;
        console.log(`[UploadService] Resuming upload from chunk index: ${nextChunkIndex}`);
      }
    } catch (err) {
      console.log('[UploadService] No existing upload session found on server. Starting fresh.');
    }

    // 2. If starting fresh, initiate session on the server
    if (nextChunkIndex === 0) {
      await api.post('/upload/initiate', {
        uploadId,
        filename: file.name,
        size: file.size,
        mimetype: file.type || 'application/octet-stream',
        roomId,
      });
      
      // Save checkpoint in IndexedDB
      await localDb.put('upload_checkpoints', {
        fileHash: uploadId,
        nextChunkIndex: 0,
        totalChunks,
      });
    }

    let finalResponse = null;

    // 3. Sequential upload of remaining chunks
    for (let i = nextChunkIndex; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunkSlice = file.slice(start, end);

      const formData = new FormData();
      // Name it 'chunk' to match backend upload.single('chunk') multer handler
      formData.append('chunk', chunkSlice, file.name);
      formData.append('uploadId', uploadId);
      formData.append('chunkIndex', i.toString());
      formData.append('totalChunks', totalChunks.toString());
      formData.append('roomId', roomId);

      console.log(`[UploadService] Uploading chunk ${i + 1}/${totalChunks}...`);
      
      const chunkRes = await api.post('/upload/chunk', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Update progress checkpoint in IndexedDB
      await localDb.put('upload_checkpoints', {
        fileHash: uploadId,
        nextChunkIndex: i + 1,
        totalChunks,
      });

      // Call progress callback
      if (onProgress) {
        const percent = Math.min(100, Math.round(((i + 1) / totalChunks) * 100));
        onProgress(percent);
      }

      if (i === totalChunks - 1) {
        // Last chunk returns the merged file details
        finalResponse = chunkRes.data;
      }
    }

    // 4. Clean up IndexedDB checkpoint on complete success
    await localDb.delete('upload_checkpoints', uploadId);

    if (!finalResponse) {
      throw new Error('Upload completed but final response was empty.');
    }

    return finalResponse;
  }
}
