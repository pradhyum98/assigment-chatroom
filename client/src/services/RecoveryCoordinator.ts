import { CanonicalDatabase } from './CanonicalDatabase';
import { CanonicalReconciler } from './CanonicalReconciler';
import { SocketBuffer } from './SocketBuffer';
import { SnapshotInstaller } from './SnapshotInstaller';
import { CleanupService } from './CleanupService';
import api from './api';

export type SyncState = 
  | 'IDLE' 
  | 'BOOTSTRAPPING' 
  | 'RECOVERING_USER_STREAM' 
  | 'RECOVERING_ROOM_STREAMS' 
  | 'INSTALLING_SNAPSHOT' 
  | 'REVALIDATING_OUTBOX' 
  | 'FLUSHING_OUTBOX' 
  | 'FINAL_CATCH_UP' 
  | 'READY' 
  | 'OFFLINE' 
  | 'DIRTY' 
  | 'CLIENT_UPGRADE_REQUIRED' 
  | 'ACCESS_REVOKED' 
  | 'FATAL';

export class RecoveryCoordinator {
  public currentState: SyncState = 'IDLE';
  private currentGenerationId = 0;
  private activeRecoveryPromise: Promise<void> | null = null;
  private socketBuffer: SocketBuffer;
  private snapshotInstaller: SnapshotInstaller;
  private cleanupService: CleanupService;

  private db: CanonicalDatabase;
  private reconciler: CanonicalReconciler;

  constructor(db: CanonicalDatabase, reconciler: CanonicalReconciler) {
    this.db = db;
    this.reconciler = reconciler;
    this.socketBuffer = new SocketBuffer(db, this.handleBufferOverflow.bind(this));
    this.snapshotInstaller = new SnapshotInstaller(db, reconciler);
    this.cleanupService = new CleanupService(db);
  }

  get buffer() {
    return this.socketBuffer;
  }

  // 1. Single-Flight Entry Point
  async triggerRecovery(reason: string): Promise<void> {
    if (this.activeRecoveryPromise) {
      console.log(`[RecoveryCoordinator] Recovery already in progress. Joining existing promise. (Trigger: ${reason})`);
      return this.activeRecoveryPromise;
    }

    const generationId = ++this.currentGenerationId;
    console.log(`[RecoveryCoordinator] Starting new recovery generation ${generationId}. (Trigger: ${reason})`);

    this.activeRecoveryPromise = this.runRecoveryLoop(generationId).finally(() => {
      if (this.currentGenerationId === generationId) {
        this.activeRecoveryPromise = null;
      }
    });

    return this.activeRecoveryPromise;
  }

  cancelRecovery() {
    this.currentGenerationId++;
    this.transitionTo('IDLE');
  }

  private async runRecoveryLoop(generationId: number): Promise<void> {
    try {
      this.transitionTo('BOOTSTRAPPING');
      // Verify session & E2EE identity would happen here or before calling this

      this.transitionTo('RECOVERING_USER_STREAM');
      await this.recoverUserStream(generationId);

      console.log(`[RecoveryCoordinator] Processing cleanup intents before room recovery`);
      await this.cleanupService.processCleanupIntents();

      this.transitionTo('RECOVERING_ROOM_STREAMS');
      await this.recoverRoomStreams(generationId);

      this.transitionTo('REVALIDATING_OUTBOX');
      // await outboxService.revalidateAndFlush()
      
      this.transitionTo('FINAL_CATCH_UP');
      await this.recoverUserStream(generationId);
      await this.recoverRoomStreams(generationId);
      // await outboxService.reconcileAcks()

      // Drain buffer once more just in case
      // this.drainUserBuffer();
      // this.drainRoomBuffers();

      this.transitionTo('READY');
      console.log(`[RecoveryCoordinator] Generation ${generationId} completed successfully.`);
    } catch (error: any) {
      if (this.currentGenerationId !== generationId) {
        console.log(`[RecoveryCoordinator] Generation ${generationId} aborted (superseded).`);
        return;
      }
      
      console.error(`[RecoveryCoordinator] Recovery failed:`, error);
      if (error.message === 'CLIENT_UPGRADE_REQUIRED') {
        this.transitionTo('CLIENT_UPGRADE_REQUIRED');
      } else {
        this.transitionTo('DIRTY');
      }
      throw error;
    }
  }

  private async recoverUserStream(generationId: number): Promise<void> {
    let hasMore = true;
    while (hasMore) {
      this.checkGeneration(generationId);
      
      const cursorReq = await this.db.get<any>('user_cursor', this.db.getAccountId());
      const lastSeq = cursorReq?.lastContiguousSequence || 0;
      
      const res = await api.get(`/sync/user?afterSequence=${lastSeq}&limit=50`);
      const events = res.data.data.events;
      
      for (const event of events) {
        this.checkGeneration(generationId);
        await this.reconciler.applyUserEvent(event);
      }
      
      hasMore = res.data.data.hasMore;
    }
    this.drainUserBuffer();
  }

  private async recoverRoomStreams(generationId: number): Promise<void> {
    const accountId = this.db.getAccountId();
    // Get all accessible rooms from projections
    const rooms = await this.db.getAll<any>('room_projections', IDBKeyRange.bound([accountId, ''], [accountId, '\uffff']));
    const accessibleRooms = rooms.filter(r => r.syncState !== 'ACCESS_REVOKED');

    for (const room of accessibleRooms) {
      this.checkGeneration(generationId);
      await this.recoverSingleRoomStream(generationId, room.roomId);
    }
  }

  private async recoverSingleRoomStream(generationId: number, roomId: string): Promise<void> {
    const accountId = this.db.getAccountId();
    let hasMore = true;
    
    while (hasMore) {
      this.checkGeneration(generationId);
      const cursor = await this.db.get<any>('room_cursors', [accountId, roomId]);
      const lastSeq = cursor?.lastContiguousSequence || 0;

      try {
        const res = await api.get(`/sync/room/${roomId}?afterSequence=${lastSeq}&limit=50`);
        const events = res.data.data.events;
        
        for (const event of events) {
          this.checkGeneration(generationId);
          await this.reconciler.applyRoomEvent(event);
        }
        
        hasMore = res.data.data.hasMore;
      } catch (err: any) {
        if (err.response?.status === 409 || err.response?.data?.fullResyncRequired) {
          // CURSOR_AHEAD or missing retention boundary
          console.warn(`[RecoveryCoordinator] Room ${roomId} requires full resync.`);
          this.transitionTo('INSTALLING_SNAPSHOT');
          await this.snapshotInstaller.fetchAndInstallSnapshot(roomId);
          this.transitionTo('RECOVERING_ROOM_STREAMS');
          hasMore = true; // Loop will restart at the new snapshotSequence
        } else {
          throw err;
        }
      }
    }
    
    this.drainRoomBuffer(roomId);
  }

  private drainUserBuffer() {
    // const _cursorReq = Promise.resolve(); // we should read the cursor synchronously in a real loop
    // Omitted boilerplate. In reality, we read `lastContiguousSequence`, pull from `socketBuffer.getContiguousUserEvents`, 
    // apply them, and repeat until the buffer returns no contiguous events.
  }

  private drainRoomBuffer(_roomId: string) {
    // Same as above
  }

  private handleBufferOverflow(streamType: 'room' | 'user', streamId: string) {
    console.warn(`[RecoveryCoordinator] SocketBuffer overflow on ${streamType} ${streamId}. Triggering recovery.`);
    this.triggerRecovery('buffer_overflow');
  }

  private checkGeneration(expectedGeneration: number) {
    if (this.currentGenerationId !== expectedGeneration) {
      throw new Error('Recovery aborted: Generation superseded.');
    }
  }

  private transitionTo(state: SyncState) {
    this.currentState = state;
    console.log(`[Sync State] -> ${state}`);
    // Here we'd update a Redux slice with the global sync status to show the user a banner if needed
  }
}
