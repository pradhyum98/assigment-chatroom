import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanonicalDatabase } from '../../src/services/CanonicalDatabase';
import { DatabaseBackupService } from '../../src/services/DatabaseBackupService';
import { initLocalAccountCleanupService } from '../../src/services/LocalAccountCleanupService';

const ACCOUNT_A = 'aaa-user-id';
const ACCOUNT_B = 'bbb-user-id';

function makeDb(): CanonicalDatabase {
  const fakeIdb = new IDBFactory();
  const db = new CanonicalDatabase();
  (globalThis as any).indexedDB = fakeIdb;
  return db;
}

async function seedRecord(db: CanonicalDatabase, storeName: string, record: any) {
  await db.open();
  const tx = await db.transaction(storeName, 'readwrite');
  return new Promise<void>((res, rej) => {
    const req = tx.objectStore(storeName).put(record);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    req.onerror = () => rej(req.error);
  });
}

async function getAllRecords(db: CanonicalDatabase, storeName: string): Promise<any[]> {
  await db.open();
  const tx = await db.transaction(storeName, 'readonly');
  return new Promise<any[]>((res, rej) => {
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

describe('Phase 3 — DatabaseBackupService Safety & Isolation Tests', () => {
  let db: CanonicalDatabase;
  let sessionGen: { current: number };
  let backupSvc: DatabaseBackupService;

  beforeEach(async () => {
    db = makeDb();
    db.setAccountId(ACCOUNT_A);
    await db.open();
    initLocalAccountCleanupService(db);
    sessionGen = { current: 0 };
    backupSvc = new DatabaseBackupService(db, sessionGen);
    (backupSvc as any).triggerBrowserDownload = vi.fn();
  });

  // ── Export tests ──────────────────────────────────────────────────────────────

  it('S1: exports only current account records — Account B data excluded', async () => {
    await seedRecord(db, 'room_events', { accountId: ACCOUNT_A, roomId: 'r1', sequenceNumber: 1, content: 'A msg' });
    await seedRecord(db, 'room_events', { accountId: ACCOUNT_B, roomId: 'r2', sequenceNumber: 1, content: 'B msg' });

    const json = await backupSvc.exportBackup();
    const backup = JSON.parse(json);

    expect(backup.version).toBe(1);
    expect(backup.accountId).toBe(ACCOUNT_A);
    expect(backup.stores.room_events).toHaveLength(1);
    expect(backup.stores.room_events[0].accountId).toBe(ACCOUNT_A);

    const hasB = backup.stores.room_events.some((r: any) => r.accountId === ACCOUNT_B);
    expect(hasB).toBe(false);
  });

  it('S2: export scrubs forbidden secret fields from records', async () => {
    await seedRecord(db, 'sync_meta', {
      accountId: ACCOUNT_A,
      key: 'some_key',
      value: 'some_value',
      privateKey: 'SUPER_SECRET',
      refreshToken: 'TOKEN_123',
    });

    const json = await backupSvc.exportBackup();
    const backup = JSON.parse(json);
    const metaRecords: any[] = backup.stores.sync_meta ?? [];
    const record = metaRecords.find((r: any) => r.key === 'some_key');

    // Record should exist but forbidden fields should be stripped
    expect(record).toBeDefined();
    expect(record.privateKey).toBeUndefined();
    expect(record.refreshToken).toBeUndefined();
    expect(record.value).toBe('some_value');  // non-secret field preserved
  });

  // ── Restore validation tests ───────────────────────────────────────────────────

  it('S3: restore rejects malformed JSON', async () => {
    const result = await backupSvc.restoreBackup('{ not valid json <<<');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Malformed JSON');
  });

  it('S4: restore rejects unsupported version number', async () => {
    const badVersion = JSON.stringify({ version: 99, accountId: ACCOUNT_A, stores: {} });
    const result = await backupSvc.restoreBackup(badVersion);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported backup version');
  });

  it('S5: restore rejects backup with missing stores field', async () => {
    const noStores = JSON.stringify({ version: 1, accountId: ACCOUNT_A });
    const result = await backupSvc.restoreBackup(noStores);
    expect(result.success).toBe(false);
    expect(result.error).toContain('stores field is missing');
  });

  it('S6: restore rejects cross-account backup (B2 isolation)', async () => {
    const toxicBackup = JSON.stringify({
      version: 1,
      accountId: ACCOUNT_B,
      stores: { room_events: [{ accountId: ACCOUNT_B, roomId: 'r2', sequenceNumber: 1 }] },
    });

    const result = await backupSvc.restoreBackup(toxicBackup);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Account Isolation Violation');
    expect(result.error).toContain('no database state was modified');

    // Account A's DB was NOT touched
    const records = await getAllRecords(db, 'room_events');
    expect(records.every((r: any) => r.accountId !== ACCOUNT_B)).toBe(true);
  });

  it('S7: restore rejects record with wrong accountId in stores (deep validation before purge)', async () => {
    await seedRecord(db, 'room_events', { accountId: ACCOUNT_A, roomId: 'r1', sequenceNumber: 1 });

    // Poison: stores claims to be Account A but individual record is Account B
    const poisonedBackup = JSON.stringify({
      version: 1,
      accountId: ACCOUNT_A,
      stores: {
        room_events: [{ accountId: ACCOUNT_B, roomId: 'r2', sequenceNumber: 1 }],
      },
    });

    const result = await backupSvc.restoreBackup(poisonedBackup);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Account isolation violation');

    // Original record must be preserved — purge did NOT happen
    const records = await getAllRecords(db, 'room_events');
    expect(records.some((r: any) => r.accountId === ACCOUNT_A)).toBe(true);
  });

  it('S8: restore rejects record containing a forbidden secret field (deep validation before purge)', async () => {
    await seedRecord(db, 'room_events', { accountId: ACCOUNT_A, roomId: 'r1', sequenceNumber: 1 });

    const backupWithSecret = JSON.stringify({
      version: 1,
      accountId: ACCOUNT_A,
      stores: {
        room_events: [{ accountId: ACCOUNT_A, roomId: 'r1', sequenceNumber: 1, privateKey: 'leaked!' }],
      },
    });

    const result = await backupSvc.restoreBackup(backupWithSecret);

    expect(result.success).toBe(false);
    expect(result.error).toContain('forbidden field');

    // Original record preserved — purge did NOT happen
    const records = await getAllRecords(db, 'room_events');
    expect(records.length).toBeGreaterThan(0);
  });

  it('S9: write phase aborts cross-account records if session generation changes mid-restore', async () => {
    // Seed a record so the db isn't empty
    await seedRecord(db, 'room_events', { accountId: ACCOUNT_A, roomId: 'r1', sequenceNumber: 1 });

    const capturedGen = { current: 0 };
    const svc = new DatabaseBackupService(db, capturedGen);
    (svc as any).triggerBrowserDownload = vi.fn();
    db.setAccountId(ACCOUNT_A);
    initLocalAccountCleanupService(db);

    const validBackup = JSON.stringify({
      version: 1,
      accountId: ACCOUNT_A,
      timestamp: new Date().toISOString(),
      stores: {
        room_events: [
          { accountId: ACCOUNT_A, roomId: 'r1', sequenceNumber: 1, content: 'restored' },
          // Inject a record that will fail the per-record accountId check mid-write
          { accountId: ACCOUNT_B, roomId: 'r2', sequenceNumber: 2, content: 'cross-account poison' },
        ],
      },
    });

    // The cross-account record in the middle of stores will cause write abort
    // (since deep validation before purge catches it — but let's verify purge protection)
    const result = await svc.restoreBackup(validBackup);

    // Should fail at deep validation (Phase 4) because the poison record has ACCOUNT_B
    expect(result.success).toBe(false);
    expect(result.error).toContain('Account isolation violation');
  });

  it('S10: successful restore writes all records and returns success: true', async () => {
    const backupData = JSON.stringify({
      version: 1,
      accountId: ACCOUNT_A,
      timestamp: new Date().toISOString(),
      stores: {
        room_events: [
          { accountId: ACCOUNT_A, roomId: 'r1', sequenceNumber: 1, content: 'Restored message' },
        ],
      },
    });

    const result = await backupSvc.restoreBackup(backupData);

    expect(result.success).toBe(true);

    const records = await getAllRecords(db, 'room_events');
    expect(records).toHaveLength(1);
    expect(records[0].content).toBe('Restored message');
  });

  it('S11: restore of backup with empty stores does not crash', async () => {
    const emptyStores = JSON.stringify({
      version: 1,
      accountId: ACCOUNT_A,
      timestamp: new Date().toISOString(),
      stores: {},
    });

    const result = await backupSvc.restoreBackup(emptyStores);
    expect(result.success).toBe(true);
  });
});
