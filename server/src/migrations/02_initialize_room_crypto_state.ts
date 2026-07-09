import mongoose from 'mongoose';
import { ChatRoom } from '../models/ChatRoom';
import { User } from '../models/User';
import { logger } from '../middleware/logger';
import dotenv from 'dotenv';
import connectDB from '../config/db';

dotenv.config();

/**
 * Migration 02 — initialize_room_crypto_state
 *
 * For every ChatRoom that has not yet been migrated:
 * - If ALL encryptedRoomKeys are legacy plain strings → cryptoState = ROTATION_REQUIRED
 * - If ALL encryptedRoomKeys are proper { encryptedKey, identityVersion } objects
 *   AND identityVersions match the current user identityVersions → cryptoState = ACTIVE
 * - Mixed / unverifiable → ROTATION_REQUIRED
 *
 * Uses raw collection access to avoid Mongoose schema validation on legacy data.
 */
const migrate = async (isDryRun = false) => {
  try {
    await connectDB();
    logger.info(`Starting migration: initialize_room_crypto_state (Dry Run: ${isDryRun})`);

    let activeCount = 0;
    let rotationRequiredCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Use raw collection to avoid schema validation on legacy string-valued maps
    const rawRooms = await ChatRoom.collection.find({}).toArray();

    for (const raw of rawRooms) {
      try {
        // Skip already-migrated rooms: has a real cryptoState AND non-default version
        if (raw.cryptoState && (raw.roomKeyVersion > 1 || raw.membershipRevision > 1)) {
          skippedCount++;
          continue;
        }

        const envelopeMap: Record<string, any> = raw.encryptedRoomKeys || {};
        const participantIds: string[] = (raw.participants || []).map((p: any) => p.toString());

        let allLegacyStrings = true;
        let allProper = true;
        const newEnvelopes: Record<string, any> = {};

        for (const [userId, envelope] of Object.entries(envelopeMap)) {
          if (typeof envelope === 'string') {
            // Legacy: plain base64 string — no identity version verifiable
            newEnvelopes[userId] = { encryptedKey: envelope, identityVersion: 0 };
            allProper = false;
          } else if (
            envelope &&
            typeof envelope === 'object' &&
            typeof envelope.encryptedKey === 'string' &&
            typeof envelope.identityVersion === 'number'
          ) {
            newEnvelopes[userId] = envelope;
            allLegacyStrings = false;
          } else {
            // Unknown format → treat as requiring rotation
            newEnvelopes[userId] = { encryptedKey: String(envelope), identityVersion: 0 };
            allProper = false;
          }
        }

        // Determine validity:
        // - Pure legacy strings → ROTATION_REQUIRED (identity versions unknowable)
        // - Has proper envelopes → verify identityVersions against current DB users
        let isValid = false;

        if (!allLegacyStrings && allProper && participantIds.length > 0) {
          // Check identity versions against live user records
          try {
            const users = await User.find({ _id: { $in: participantIds } }).lean();
            const userVersions: Record<string, number> = {};
            for (const u of users) {
              userVersions[u._id.toString()] = u.identityVersion || 1;
            }

            isValid = participantIds.every((pid) => {
              const env = newEnvelopes[pid];
              if (!env) return false;
              return env.identityVersion === (userVersions[pid] ?? 1);
            });
          } catch (_) {
            isValid = false;
          }
        }
        // If all legacy strings → isValid remains false → ROTATION_REQUIRED

        const cryptoState = isValid ? 'ACTIVE' : 'ROTATION_REQUIRED';

        if (!isDryRun) {
          await ChatRoom.collection.updateOne(
            { _id: raw._id },
            {
              $set: {
                encryptedRoomKeys: newEnvelopes,
                cryptoState,
                roomKeyVersion: raw.roomKeyVersion || 1,
                membershipRevision: raw.membershipRevision || 1,
              },
            }
          );
        }

        if (isValid) {
          activeCount++;
        } else {
          rotationRequiredCount++;
          logger.info(`Room ${raw.roomId} set to ROTATION_REQUIRED (legacy or unverifiable keys)`);
        }
      } catch (err) {
        failedCount++;
        logger.error(`Migration failed for room ${raw.roomId}:`, err);
      }
    }

    logger.info(`Migration complete.`);
    logger.info(`Active: ${activeCount}`);
    logger.info(`Rotation Required: ${rotationRequiredCount}`);
    logger.info(`Skipped: ${skippedCount}`);
    logger.info(`Failed: ${failedCount}`);
  } catch (err) {
    logger.error('Migration failed:', err);
    throw err;
  }
};

if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  migrate(isDryRun).finally(async () => {
    await mongoose.connection.close();
  });
}

export default migrate;
