import mongoose, { Document, Schema } from 'mongoose';

export interface IRefreshSession extends Document {
  userId: mongoose.Types.ObjectId;
  familyId: string;
  tokenId: string;
  tokenHash: string;
  parentTokenId: string | null;
  replacedByTokenId: string | null;
  issuedAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  revocationReason: 'logout' | 'logout_all' | 'replay_detected' | 'password_reset' | null;
  deviceLabel?: string;
  ipAddress?: string;
}

const refreshSessionSchema = new Schema<IRefreshSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenId: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true, unique: true },
    parentTokenId: { type: String, default: null },
    replacedByTokenId: { type: String, default: null },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revocationReason: {
      type: String,
      enum: ['logout', 'logout_all', 'replay_detected', 'password_reset', null],
      default: null,
    },
    deviceLabel: { type: String },
    ipAddress: { type: String },
  },
  { timestamps: true }
);

// TTL index to automatically clean up expired sessions from MongoDB
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshSession = mongoose.model<IRefreshSession>('RefreshSession', refreshSessionSchema);
