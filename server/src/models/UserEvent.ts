import mongoose, { Schema, Document } from 'mongoose';

export enum UserEventType {
  ROOM_ACCESS_GRANTED = 'ROOM_ACCESS_GRANTED',
  ROOM_ACCESS_REVOKED = 'ROOM_ACCESS_REVOKED',
  ROOM_DELETED = 'ROOM_DELETED',
  IDENTITY_RESET = 'IDENTITY_RESET',
  SESSION_SECURITY = 'SESSION_SECURITY',
}

export interface UserEventDoc extends Document {
  userId: string;
  sequenceNumber: number;
  eventType: UserEventType;
  eventVersion: number;
  payload: any;
  createdAt: Date;
}

const UserEventSchema = new Schema<UserEventDoc>({
  userId: {
    type: String,
    required: true,
  },
  sequenceNumber: {
    type: Number,
    required: true,
  },
  eventType: {
    type: String,
    enum: Object.values(UserEventType),
    required: true,
  },
  eventVersion: {
    type: Number,
    required: true,
    default: 1,
  },
  payload: {
    type: Schema.Types.Mixed,
    required: true,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false }, // Immutable
});

UserEventSchema.index({ userId: 1, sequenceNumber: 1 }, { unique: true });

UserEventSchema.pre('validate', function(next) {
  if (this.isModified('payload')) {
    try {
      const { validateUserEventPayload } = require('../utils/eventContracts');
      this.payload = validateUserEventPayload(this.eventType, this.payload);
      next();
    } catch (err: any) {
      next(err);
    }
  } else {
    next();
  }
});

export const UserEvent = mongoose.model<UserEventDoc>('UserEvent', UserEventSchema);
