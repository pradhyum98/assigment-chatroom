/**
 * CanonicalHistoryInstaller
 *
 * Installs historical REST-fetched message pages into IndexedDB projections
 * while enforcing strict invariants:
 *
 * 1. Validates response schema (required fields present).
 * 2. Binds to a session generation — aborts on logout/account switch.
 * 3. Never advances the RoomEvent cursor.
 * 4. Never overwrites newer canonical projections (editedAt gating).
 * 5. Never resurrects deleted messages.
 * 6. Never overwrites newer reactions/receipts.
 * 7. Deduplicates by messageId.
 * 8. Commits all page writes atomically in a single IDBTransaction.
 * 9. Notifies Redux only inside tx.oncomplete.
 */

import { CanonicalDatabase } from './CanonicalDatabase';
import { projectionSubscriptionService } from './ProjectionSubscriptionService';
import type { ProjectionChangeSet } from './ProjectionSubscriptionService';

// ── Minimal validated message shape ─────────────────────────────────────────

interface HistoricalMessageRaw {
  messageId?: string;
  _id?: string;
  senderId: string;
  senderName: string;
  roomId?: string;
  content?: string;
  timestamp?: string;
  isEdited?: boolean;
  isDeleted?: boolean;
  deletedForEveryone?: boolean;
  editedAt?: string;
  type?: string;
  mediaUrl?: string;
  mediaFilename?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  encryptionVersion?: number;
  wrappedMediaKey?: string;
  mediaKeyIv?: string;
  mediaIv?: string;
  iv?: string;
  reactions?: unknown[];
  readBy?: unknown[];
  deliveredTo?: unknown[];
  replyTo?: string;
}

function validateMessage(raw: unknown): HistoricalMessageRaw {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid message: not an object');
  const msg = raw as Record<string, unknown>;
  const messageId = (msg.messageId ?? msg._id) as string | undefined;
  if (!messageId) throw new Error('Invalid message: missing messageId/_id');
  if (typeof msg.senderId !== 'string') throw new Error(`Invalid message ${messageId}: missing senderId`);
  if (typeof msg.senderName !== 'string') throw new Error(`Invalid message ${messageId}: missing senderName`);
  return msg as unknown as HistoricalMessageRaw;
}

// ── Installer ────────────────────────────────────────────────────────────────

export class CanonicalHistoryInstaller {
  private db: CanonicalDatabase;

  constructor(db: CanonicalDatabase) {
    this.db = db;
  }

  /**
   * Install a single page of historical messages from the REST response.
   *
   * @param roomId   Room being loaded.
   * @param rawPage  Array of raw server message objects (unvalidated).
   * @param generationRef  Object with `current: number` — compared before each
   *                       async step. If the caller increments it (logout / account
   *                       switch), installation aborts without writing anything.
   * @returns `{ written: number }` — number of messages actually written.
   */
  async installPage(
    roomId: string,
    rawPage: unknown[],
    generationRef: { current: number },
    initialGeneration: number
  ): Promise<{ written: number }> {
    // 1. Validate schema — do this synchronously before touching IDB
    const validated: HistoricalMessageRaw[] = [];
    for (const raw of rawPage) {
      try {
        validated.push(validateMessage(raw));
      } catch (e) {
        console.warn('[CanonicalHistoryInstaller] Skipping invalid message:', e);
      }
    }

    if (validated.length === 0) return { written: 0 };

    // 2. Generation check before opening IDB transaction
    if (generationRef.current !== initialGeneration) {
      console.warn('[CanonicalHistoryInstaller] Generation changed — aborting installPage (pre-tx)');
      return { written: 0 };
    }

    const accountId = this.db.getAccountId();

    // 3. Collect existing projections to enforce conflict resolution
    const messageIds = validated.map(m => (m.messageId ?? m._id)!);
    const existingMap = new Map<string, Record<string, unknown>>();

    // Read existing projections in one pass before the write tx
    const readTx = await this.db.transaction('message_projections', 'readonly');
    await new Promise<void>((resolve, reject) => {
      let pending = messageIds.length;
      if (pending === 0) { resolve(); return; }
      for (const id of messageIds) {
        const req = readTx.objectStore('message_projections').get([accountId, id]);
        req.onsuccess = () => {
          if (req.result) existingMap.set(id, req.result);
          if (--pending === 0) resolve();
        };
        req.onerror = () => reject(req.error);
      }
    });

    // 4. Generation check after reads (could take time)
    if (generationRef.current !== initialGeneration) {
      console.warn('[CanonicalHistoryInstaller] Generation changed — aborting installPage (post-read)');
      return { written: 0 };
    }

    // 5. Determine what actually needs writing
    const toWrite: Record<string, unknown>[] = [];
    const changes: ProjectionChangeSet = [];

    for (const msg of validated) {
      const messageId = (msg.messageId ?? msg._id)!;
      const existing = existingMap.get(messageId);

      if (existing) {
        // Never resurrect deleted messages
        if (existing.deletedForEveryone || existing.isDeleted) continue;

        // Never overwrite newer canonical edits
        const existingEditedAt = (existing.editedAt as string) ?? '';
        const incomingEditedAt = msg.editedAt ?? '';
        if (existingEditedAt && incomingEditedAt < existingEditedAt) continue;

        // Deduplicate — skip if identical
        if (!msg.isEdited && existingEditedAt && !incomingEditedAt) continue;

        // Merge reactions/readBy/deliveredTo: keep existing (newer)
        const merged = {
          ...msg,
          messageId,
          accountId,
          roomId,
          reactions: existing.reactions ?? msg.reactions ?? [],
          readBy: existing.readBy ?? msg.readBy ?? [],
          deliveredTo: existing.deliveredTo ?? msg.deliveredTo ?? [],
        };
        toWrite.push(merged);
        changes.push({ type: 'MESSAGE_INSERTED', payload: merged });
      } else {
        // Net-new historical message
        const projection = {
          accountId,
          roomId,
          messageId,
          senderId: msg.senderId,
          senderName: msg.senderName,
          content: msg.content ?? '',
          timestamp: msg.timestamp ?? new Date(0).toISOString(),
          isEdited: msg.isEdited ?? false,
          isDeleted: msg.isDeleted ?? false,
          deletedForEveryone: msg.deletedForEveryone ?? false,
          editedAt: msg.editedAt,
          type: msg.type ?? 'text',
          mediaUrl: msg.mediaUrl,
          mediaFilename: msg.mediaFilename,
          mediaMimeType: msg.mediaMimeType,
          mediaSize: msg.mediaSize,
          encryptionVersion: msg.encryptionVersion,
          wrappedMediaKey: msg.wrappedMediaKey,
          mediaKeyIv: msg.mediaKeyIv,
          mediaIv: msg.mediaIv,
          iv: msg.iv,
          reactions: msg.reactions ?? [],
          readBy: msg.readBy ?? [],
          deliveredTo: msg.deliveredTo ?? [],
          replyTo: msg.replyTo,
        };
        toWrite.push(projection);
        changes.push({ type: 'MESSAGE_INSERTED', payload: projection });
      }
    }

    if (toWrite.length === 0) return { written: 0 };

    // 6. Atomic write — all or nothing
    const writeTx = await this.db.transaction('message_projections', 'readwrite');
    const store = writeTx.objectStore('message_projections');
    for (const projection of toWrite) {
      store.put(projection);
    }

    // 7. Redux notification ONLY inside oncomplete — never before commit
    return new Promise<{ written: number }>((resolve, reject) => {
      writeTx.oncomplete = () => {
        // Final generation check: if changed during write, do not notify Redux
        if (generationRef.current === initialGeneration) {
          projectionSubscriptionService.notifyChanges(changes);
        } else {
          console.warn('[CanonicalHistoryInstaller] Generation changed — suppressing Redux notification');
        }
        resolve({ written: toWrite.length });
      };
      writeTx.onerror = () => reject(writeTx.error);
      writeTx.onabort = () => reject(new Error('IDB transaction aborted'));
    });
  }
}
