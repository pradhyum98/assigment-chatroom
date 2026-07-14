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
  // Tracks rooms currently undergoing a targeted recovery to prevent duplicate concurrent recoveries
  private roomRecoveryInProgress = new Set<string>();

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

  async handleIncomingRoomEvent(rawPayload: any): Promise<void> {
    // Server emits two shapes:
    //   1. RoomEventService: single envelope  { roomId, sequenceNumber, eventType, ... }
    //   2. Other controllers: array wrapper   { events: [ envelope, ... ] }
    // Normalize both into an array of envelopes.
    const envelopes: any[] = Array.isArray(rawPayload?.events)
      ? rawPayload.events
      : [rawPayload];

    for (const event of envelopes) {
      if (!event?.roomId || event?.sequenceNumber == null) {
        continue;
      }

      const success = this.socketBuffer.bufferRoomEvent(event);
      if (!success || this.currentState !== 'READY') continue;

      const accountId = this.db.getAccountId();
      const cursor = await this.db.get<any>('room_cursors', [accountId, event.roomId]);
      const lastSeq = cursor?.lastContiguousSequence || 0;

      if (event.sequenceNumber > lastSeq + 1) {
        // GAP DETECTED: room_cursors is behind the incoming event.
        // This happens when fetchMessages() loaded messages via REST (updating Redux) but
        // never advanced the IDB cursor. The drain loop expects seq lastSeq+1 and silently
        // drops anything higher. Fix: run a targeted single-room recovery to sync IDB up,
        // then drain will find the buffered event as contiguous and apply it.
        if (!this.roomRecoveryInProgress.has(event.roomId)) {
          console.log(
            `[RecoveryCoordinator] Gap detected room=${event.roomId} cursorSeq=${lastSeq} eventSeq=${event.sequenceNumber}. Triggering targeted recovery.`
          );
          this.roomRecoveryInProgress.add(event.roomId);
          try {
            await this.recoverSingleRoomStream(this.currentGenerationId, event.roomId);
          } catch (e: any) {
            // If the generation changed mid-recovery that's fine; new event stays in buffer
            // and will be drained by the next full recovery cycle.
            console.warn('[RecoveryCoordinator] Targeted room recovery failed:', e?.message);
          } finally {
            this.roomRecoveryInProgress.delete(event.roomId);
          }
        }
        // If recovery is already in progress, the event is buffered and will be
        // drained by that in-flight recoverSingleRoomStream at its end.
      } else {
        // No gap — drain the buffer immediately.
        await this.drainRoomBuffer(event.roomId);
      }
    }
  }

  async handleIncomingUserEvent(event: any): Promise<void> {
    const success = this.socketBuffer.bufferUserEvent(event);
    if (success && this.currentState === 'READY') {
      await this.drainUserBuffer();
    }
  }

  private async drainUserBuffer(): Promise<void> {
    const accountId = this.db.getAccountId();
    let hasMore = true;
    while (hasMore) {
      const cursorReq = await this.db.get<any>('user_cursor', accountId);
      const lastSeq = cursorReq?.lastContiguousSequence || 0;
      const events = this.socketBuffer.getContiguousUserEvents(lastSeq);
      if (events.length === 0) {
        hasMore = false;
        break;
      }
      for (const event of events) {
        await this.reconciler.applyUserEvent(event);
      }
      const maxSeq = events[events.length - 1].sequenceNumber;
      this.socketBuffer.removeUserEvents(maxSeq);
    }
  }

  private async drainRoomBuffer(roomId: string): Promise<void> {
    const accountId = this.db.getAccountId();
    let hasMore = true;
    while (hasMore) {
      const cursor = await this.db.get<any>('room_cursors', [accountId, roomId]);
      const lastSeq = cursor?.lastContiguousSequence || 0;
      const events = this.socketBuffer.getContiguousRoomEvents(roomId, lastSeq);
      if (events.length === 0) {
        hasMore = false;
        break;
      }
      for (const event of events) {
        await this.reconciler.applyRoomEvent(event);
      }
      const maxSeq = events[events.length - 1].sequenceNumber;
      this.socketBuffer.removeRoomEvents(roomId, maxSeq);
    }
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
