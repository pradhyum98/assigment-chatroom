import { CanonicalDatabase } from './CanonicalDatabase';
import { CanonicalReconciler } from './CanonicalReconciler';
import api from './api';

export class SnapshotInstaller {
  private db: CanonicalDatabase;
  constructor(db: CanonicalDatabase, _reconciler: CanonicalReconciler) {
    this.db = db;
  }

  async fetchAndInstallSnapshot(roomId: string, _expectedSequence?: number): Promise<void> {
    const accountId = this.db.getAccountId();
    console.log(`[SnapshotInstaller] Starting full resync for room ${roomId}`);

    let nextToken: string | null = null;
    let snapshotSequence: number | null = null;
    let isComplete = false;

    // 1. Create or resume manifest
    const manifestTx = await this.db.transaction('snapshot_manifests', 'readwrite');
    const manifestStore = manifestTx.objectStore('snapshot_manifests');
    const existingManifest = await new Promise<any>((resolve) => {
      const req = manifestStore.get([accountId, roomId]);
      req.onsuccess = () => resolve(req.result);
    });

    if (existingManifest && existingManifest.status === 'DOWNLOADING') {
      console.log(`[SnapshotInstaller] Resuming snapshot download from token: ${existingManifest.continuationToken}`);
      nextToken = existingManifest.continuationToken;
      snapshotSequence = existingManifest.snapshotSequence;
    } else {
      // Clear old staging data if we are starting fresh
      // In a real app we'd use a cursor to delete all staging rows for this roomId
      manifestStore.put({
        accountId,
        roomId,
        status: 'DOWNLOADING',
        continuationToken: null,
        snapshotSequence: null,
        startedAt: new Date().toISOString()
      });
    }

    // 2. Download pages
    while (!isComplete) {
      const url = `/sync/room/${roomId}/full${nextToken ? `?continuationToken=${encodeURIComponent(nextToken)}` : ''}`;
      const response = await api.get(url);
      const data = response.data.data; // Assumes standardized response format { status: 'success', data: { ... } }

      if (!snapshotSequence) {
        snapshotSequence = data.snapshotSequence;
      } else if (snapshotSequence !== data.snapshotSequence) {
        throw new Error(`Snapshot sequence mismatch. Expected ${snapshotSequence}, got ${data.snapshotSequence}`);
      }

      const tx = await this.db.transaction([
        'snapshot_room_staging',
        'snapshot_message_staging',
        'snapshot_membership_staging',
        'snapshot_manifests'
      ], 'readwrite');

      try {
        // Persist room metadata
        if (data.room) {
          tx.objectStore('snapshot_room_staging').put({
            accountId,
            roomId,
            sequenceNumber: snapshotSequence,
            data: data.room
          });
        }

        // Persist messages
        if (data.messages && data.messages.length > 0) {
          const msgStore = tx.objectStore('snapshot_message_staging');
          for (const msg of data.messages) {
            msgStore.put({
              accountId,
              roomId,
              sequenceNumber: snapshotSequence,
              messageId: msg.messageId,
              data: msg
            });
          }
        }

        // Persist memberships
        if (data.memberships) {
          tx.objectStore('snapshot_membership_staging').put({
            accountId,
            roomId,
            sequenceNumber: snapshotSequence,
            data: data.memberships
          });
        }

        nextToken = data.continuationToken || null;
        isComplete = !nextToken;

        // Update manifest
        tx.objectStore('snapshot_manifests').put({
          accountId,
          roomId,
          status: isComplete ? 'READY_TO_INSTALL' : 'DOWNLOADING',
          continuationToken: nextToken,
          snapshotSequence,
          updatedAt: new Date().toISOString()
        });

      } catch (e) {
        tx.abort();
        throw e;
      }
    }

    // 3. Atomically activate snapshot
    console.log(`[SnapshotInstaller] Download complete. Activating snapshot sequence ${snapshotSequence} for room ${roomId}`);
    await this.activateSnapshot(roomId, snapshotSequence!);
  }

  private async activateSnapshot(roomId: string, snapshotSequence: number): Promise<void> {
    const accountId = this.db.getAccountId();
    
    // We fetch staging data first because IndexedDB transactions across many stores can be tricky if we do async reads inside.
    const stagingTx = await this.db.transaction([
      'snapshot_room_staging',
      'snapshot_message_staging',
      'snapshot_membership_staging'
    ], 'readonly');

    const roomData = await this.getReq(stagingTx.objectStore('snapshot_room_staging').get([accountId, roomId, snapshotSequence]));
    
    // Getting messages requires a cursor or getAll since it's a prefix key.
    // For simplicity, we assume we can fetch them.
    const messageStore = stagingTx.objectStore('snapshot_message_staging');
    const allMessages: any[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursorReq = messageStore.openCursor();
      cursorReq.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.accountId === accountId && cursor.value.roomId === roomId && cursor.value.sequenceNumber === snapshotSequence) {
            allMessages.push(cursor.value.data);
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });

    const membershipsData = await this.getReq(stagingTx.objectStore('snapshot_membership_staging').get([accountId, roomId, snapshotSequence]));

    // Now write to active projections atomically
    const tx = await this.db.transaction([
      'room_projections',
      'message_projections',
      'membership_projections',
      'room_cursors',
      'snapshot_manifests'
    ], 'readwrite');

    try {
      if (roomData) {
        tx.objectStore('room_projections').put({
          accountId,
          roomId,
          syncState: 'READY',
          ...roomData.data
        });
      }

      if (membershipsData) {
        tx.objectStore('membership_projections').put({
          accountId,
          roomId,
          data: membershipsData.data
        });
      }

      const mp = tx.objectStore('message_projections');
      // In a robust generational GC system we wouldn't delete, but for this milestone we overwrite active data
      for (const msg of allMessages) {
        mp.put({
          accountId,
          messageId: msg.messageId,
          ...msg
        });
      }

      // Update Cursor
      tx.objectStore('room_cursors').put({
        accountId,
        roomId,
        lastContiguousSequence: snapshotSequence,
        snapshotSequence: snapshotSequence,
        latestKnownServerSequence: snapshotSequence,
        updatedAt: new Date().toISOString()
      });

      // Clear manifest
      tx.objectStore('snapshot_manifests').delete([accountId, roomId]);

    } catch (e) {
      tx.abort();
      throw e;
    }
  }

  private getReq(req: IDBRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
