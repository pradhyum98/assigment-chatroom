import { Types } from 'mongoose';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';

export interface Envelope {
  encryptedKey: string;
  identityVersion: number;
}

export interface ParticipantIdentity {
  userId: string;
  identityVersion: number;
}

/**
 * Validates the submitted envelope set against the canonical participant identity set.
 * 
 * @param participantIds Array of user IDs currently in the room
 * @param submittedEnvelopes The Map or Object of envelopes submitted by the client
 * @throws AppError if validation fails
 */
export const validateRoomEnvelopes = async (
  participantIds: (Types.ObjectId | string)[],
  submittedEnvelopes: Record<string, Envelope> | Map<string, Envelope>
): Promise<void> => {
  // Convert submittedEnvelopes to a JS object if it's a Map
  const envelopesObj: Record<string, Envelope> = {};
  if (submittedEnvelopes instanceof Map) {
    for (const [key, val] of submittedEnvelopes.entries()) {
      envelopesObj[key] = val;
    }
  } else {
    Object.assign(envelopesObj, submittedEnvelopes);
  }

  const canonicalParticipantIds = participantIds.map(id => id.toString());

  // Detect missing or extra envelopes
  const submittedKeys = Object.keys(envelopesObj);
  
  const missing = canonicalParticipantIds.filter(id => !submittedKeys.includes(id));
  if (missing.length > 0) {
    throw new AppError(`Missing envelopes for users: ${missing.join(', ')}`, 400);
  }

  const extra = submittedKeys.filter(id => !canonicalParticipantIds.includes(id));
  if (extra.length > 0) {
    throw new AppError(`Extra envelopes provided for non-participants: ${extra.join(', ')}`, 400);
  }

  // Load current identities for all participants
  const users = await User.find({ _id: { $in: canonicalParticipantIds } }).select('_id identityVersion').lean();
  
  if (users.length !== canonicalParticipantIds.length) {
    throw new AppError('One or more participant users could not be found in the database.', 404);
  }

  const currentIdentities: Record<string, number> = {};
  for (const user of users) {
    currentIdentities[user._id.toString()] = user.identityVersion || 1;
  }

  // Verify each envelope
  for (const userId of canonicalParticipantIds) {
    const envelope = envelopesObj[userId];
    if (!envelope || !envelope.encryptedKey || envelope.identityVersion === undefined) {
      throw new AppError(`Malformed envelope for user ${userId}`, 400);
    }

    const currentVersion = currentIdentities[userId];
    if (envelope.identityVersion !== currentVersion) {
      throw new AppError(
        `Stale or future identity version for user ${userId}. Expected ${currentVersion}, got ${envelope.identityVersion}.`,
        400
      );
    }
  }
};
