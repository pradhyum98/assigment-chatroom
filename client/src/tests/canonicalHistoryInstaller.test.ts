/**
 * CanonicalHistoryInstaller — hostile tests for historical message ingestion.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanonicalDatabase } from '../services/CanonicalDatabase';
import { CanonicalHistoryInstaller } from '../services/CanonicalHistoryInstaller';

// Mock projectionSubscriptionService
vi.mock('../services/ProjectionSubscriptionService', () => ({
  projectionSubscriptionService: {
    notifyChanges: vi.fn(),
  },
}));

import { projectionSubscriptionService } from '../services/ProjectionSubscriptionService';

const ACCOUNT = 'acct-hist';

function makeDb(): CanonicalDatabase {
  const db = new CanonicalDatabase();
  db.setAccountId(ACCOUNT);
  return db;
}

function makeMessage(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageId: id,
    senderId: 'u1',
    senderName: 'Alice',
    roomId: 'room-1',
    content: `Content of ${id}`,
    timestamp: '2024-01-01T00:00:00.000Z',
    reactions: [],
    readBy: [],
    deliveredTo: [],
    ...overrides,
  };
}

describe('CanonicalHistoryInstaller', () => {
  let db: CanonicalDatabase;
  let installer: CanonicalHistoryInstaller;
  let genRef: { current: number };

  beforeEach(async () => {
    db = makeDb();
    await db.open();
    installer = new CanonicalHistoryInstaller(db);
    genRef = { current: 1 };
    vi.clearAllMocks();
  });

  // ── Basic installation ──

  it('installs a valid page of messages', async () => {
    const page = [makeMessage('msg-1'), makeMessage('msg-2')];
    const result = await installer.installPage('room-1', page, genRef, 1);
    expect(result.written).toBe(2);

    const stored = await db.get<any>('message_projections', [ACCOUNT, 'msg-1']);
    expect(stored).toBeDefined();
    expect(stored.content).toBe('Content of msg-1');
    expect(projectionSubscriptionService.notifyChanges).toHaveBeenCalledTimes(1);
  });

  // ── Schema validation ──

  it('skips invalid messages without aborting the page', async () => {
    const page = [
      makeMessage('msg-ok'),
      { invalid: true },              // no messageId, no senderId
      null,                            // null
      { _id: 'msg-no-sender' },       // missing senderId
    ];
    const result = await installer.installPage('room-1', page as any, genRef, 1);
    expect(result.written).toBe(1);
  });

  // ── Never resurrect deleted messages ──

  it('does NOT overwrite a deleted message with historical data', async () => {
    // Pre-seed a deleted projection
    const tx = await db.transaction('message_projections', 'readwrite');
    tx.objectStore('message_projections').put({
      accountId: ACCOUNT,
      messageId: 'msg-deleted',
      roomId: 'room-1',
      senderId: 'u1',
      senderName: 'Alice',
      content: '',
      deletedForEveryone: true,
      isDeleted: true,
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });

    const page = [makeMessage('msg-deleted', { content: 'should not appear' })];
    const result = await installer.installPage('room-1', page, genRef, 1);
    expect(result.written).toBe(0);

    const stored = await db.get<any>('message_projections', [ACCOUNT, 'msg-deleted']);
    expect(stored.deletedForEveryone).toBe(true);
    expect(stored.content).toBe('');
  });

  // ── Never overwrite newer edits ──

  it('does NOT overwrite a newer edit with older historical data', async () => {
    const tx = await db.transaction('message_projections', 'readwrite');
    tx.objectStore('message_projections').put({
      accountId: ACCOUNT,
      messageId: 'msg-edited',
      roomId: 'room-1',
      senderId: 'u1',
      senderName: 'Alice',
      content: 'latest edit',
      editedAt: '2024-06-01T00:00:00.000Z',
      isEdited: true,
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });

    const page = [makeMessage('msg-edited', { content: 'old version', editedAt: '2024-01-15T00:00:00.000Z' })];
    const result = await installer.installPage('room-1', page, genRef, 1);
    expect(result.written).toBe(0);

    const stored = await db.get<any>('message_projections', [ACCOUNT, 'msg-edited']);
    expect(stored.content).toBe('latest edit');
  });

  // ── Preserves existing reactions/readBy/deliveredTo ──

  it('preserves existing reactions over historical data', async () => {
    const tx = await db.transaction('message_projections', 'readwrite');
    tx.objectStore('message_projections').put({
      accountId: ACCOUNT,
      messageId: 'msg-react',
      roomId: 'room-1',
      senderId: 'u1',
      senderName: 'Alice',
      content: 'has reactions',
      timestamp: '2024-01-01T00:00:00.000Z',
      reactions: [{ emoji: '👍', userId: 'u2' }],
      readBy: [{ userId: 'u2', readAt: '2024-01-02T00:00:00.000Z' }],
      deliveredTo: [],
    });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });

    const page = [makeMessage('msg-react', { content: 'has reactions', reactions: [], readBy: [] })];
    const result = await installer.installPage('room-1', page, genRef, 1);
    expect(result.written).toBe(1);

    const stored = await db.get<any>('message_projections', [ACCOUNT, 'msg-react']);
    // Should keep existing reactions, not overwrite with empty
    expect(stored.reactions).toHaveLength(1);
    expect(stored.readBy).toHaveLength(1);
  });

  // ── Duplicate page (idempotent) ──

  it('handles duplicate page idempotently', async () => {
    const page = [makeMessage('msg-dup')];
    await installer.installPage('room-1', page, genRef, 1);
    const result2 = await installer.installPage('room-1', page, genRef, 1);
    // Second install still writes (put is idempotent for same data)
    expect(result2.written).toBe(1);
  });

  // ── Generation change (logout during fetch) ──

  it('aborts if generation changes before IDB write', async () => {
    const page = [makeMessage('msg-gen')];
    genRef.current = 2; // simulate logout
    const result = await installer.installPage('room-1', page, genRef, 1);
    expect(result.written).toBe(0);
    expect(projectionSubscriptionService.notifyChanges).not.toHaveBeenCalled();
  });

  // ── Empty page ──

  it('handles empty page gracefully', async () => {
    const result = await installer.installPage('room-1', [], genRef, 1);
    expect(result.written).toBe(0);
    expect(projectionSubscriptionService.notifyChanges).not.toHaveBeenCalled();
  });
});
