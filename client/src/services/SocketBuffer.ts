import type { RoomEventEnvelope, UserEventEnvelope } from './EventContracts';
import { CanonicalDatabase } from './CanonicalDatabase';

export class SocketBuffer {
  private roomBuffers: Map<string, RoomEventEnvelope[]> = new Map();
  private userBuffer: UserEventEnvelope[] = [];
  
  private MAX_EVENTS_PER_STREAM = 100;
  private MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5MB
  private currentBytes = 0;

  private db: CanonicalDatabase;
  private onOverflow: (streamType: 'room' | 'user', streamId: string) => void;

  constructor(db: CanonicalDatabase, onOverflow: (streamType: 'room' | 'user', streamId: string) => void) {
    this.db = db;
    this.onOverflow = onOverflow;
  }

  bufferRoomEvent(event: RoomEventEnvelope): boolean {
    const streamId = event.roomId;
    if (!this.roomBuffers.has(streamId)) {
      this.roomBuffers.set(streamId, []);
    }
    
    const buffer = this.roomBuffers.get(streamId)!;
    
    // Deduplicate
    if (buffer.some(e => e.sequenceNumber === event.sequenceNumber)) {
      return true; // Already buffered, safe to ignore
    }

    const eventSize = JSON.stringify(event).length;
    
    if (buffer.length >= this.MAX_EVENTS_PER_STREAM || this.currentBytes + eventSize > this.MAX_TOTAL_BYTES) {
      // Overflow
      this.clearRoomBuffer(streamId);
      this.onOverflow('room', streamId);
      return false;
    }

    buffer.push(event);
    // Maintain ascending order
    buffer.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    this.currentBytes += eventSize;
    return true;
  }

  bufferUserEvent(event: UserEventEnvelope): boolean {
    // Deduplicate
    if (this.userBuffer.some(e => e.sequenceNumber === event.sequenceNumber)) {
      return true;
    }

    const eventSize = JSON.stringify(event).length;

    if (this.userBuffer.length >= this.MAX_EVENTS_PER_STREAM || this.currentBytes + eventSize > this.MAX_TOTAL_BYTES) {
      this.clearUserBuffer();
      this.onOverflow('user', this.db.getAccountId());
      return false;
    }

    this.userBuffer.push(event);
    this.userBuffer.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    this.currentBytes += eventSize;
    return true;
  }

  getContiguousRoomEvents(roomId: string, startingAfterSequence: number): RoomEventEnvelope[] {
    const buffer = this.roomBuffers.get(roomId) || [];
    const contiguous: RoomEventEnvelope[] = [];
    
    let expectedSequence = startingAfterSequence + 1;
    for (const event of buffer) {
      if (event.sequenceNumber === expectedSequence) {
        contiguous.push(event);
        expectedSequence++;
      } else if (event.sequenceNumber > expectedSequence) {
        break; // Gap found, stop pulling
      }
    }
    return contiguous;
  }

  getContiguousUserEvents(startingAfterSequence: number): UserEventEnvelope[] {
    const contiguous: UserEventEnvelope[] = [];
    
    let expectedSequence = startingAfterSequence + 1;
    for (const event of this.userBuffer) {
      if (event.sequenceNumber === expectedSequence) {
        contiguous.push(event);
        expectedSequence++;
      } else if (event.sequenceNumber > expectedSequence) {
        break;
      }
    }
    return contiguous;
  }

  removeRoomEvents(roomId: string, upToSequence: number) {
    const buffer = this.roomBuffers.get(roomId);
    if (!buffer) return;

    const kept = buffer.filter(e => {
      if (e.sequenceNumber <= upToSequence) {
        this.currentBytes -= JSON.stringify(e).length;
        return false;
      }
      return true;
    });

    if (kept.length === 0) {
      this.roomBuffers.delete(roomId);
    } else {
      this.roomBuffers.set(roomId, kept);
    }
  }

  removeUserEvents(upToSequence: number) {
    this.userBuffer = this.userBuffer.filter(e => {
      if (e.sequenceNumber <= upToSequence) {
        this.currentBytes -= JSON.stringify(e).length;
        return false;
      }
      return true;
    });
  }

  clearRoomBuffer(roomId: string) {
    const buffer = this.roomBuffers.get(roomId) || [];
    buffer.forEach(e => {
      this.currentBytes -= JSON.stringify(e).length;
    });
    this.roomBuffers.delete(roomId);
  }

  clearUserBuffer() {
    this.userBuffer.forEach(e => {
      this.currentBytes -= JSON.stringify(e).length;
    });
    this.userBuffer = [];
  }
}
