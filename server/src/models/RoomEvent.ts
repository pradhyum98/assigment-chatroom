import mongoose, { Schema, Document } from 'mongoose';

export enum RoomEventType {
  MESSAGE_CREATED = 'MESSAGE_CREATED',
  MESSAGE_EDITED = 'MESSAGE_EDITED',
  MESSAGE_DELETED = 'MESSAGE_DELETED',
  REACTION_CHANGED = 'REACTION_CHANGED',
  READ_UPDATED = 'READ_UPDATED',
  DELIVERY_UPDATED = 'DELIVERY_UPDATED',
  ROOM_METADATA_CHANGED = 'ROOM_METADATA_CHANGED',
  MEMBERSHIP_CHANGED = 'MEMBERSHIP_CHANGED',
  ADMIN_CHANGED = 'ADMIN_CHANGED',
  PINNED_MESSAGES_CHANGED = 'PINNED_MESSAGES_CHANGED',
  IDENTITY_CHANGED = 'IDENTITY_CHANGED',
  ROOM_KEY_ROTATION_REQUIRED = 'ROOM_KEY_ROTATION_REQUIRED',
  ROOM_KEY_ROTATED = 'ROOM_KEY_ROTATED'
}

export interface RoomEventDoc extends Document {
  roomId: string;
  sequenceNumber: number;
  eventType: RoomEventType;
  eventVersion: number;
  actorId?: string;
  payload: any;
  createdAt: Date;
}

const RoomEventSchema = new Schema<RoomEventDoc>({
  roomId: {
    type: String,
    required: true,
  },
  sequenceNumber: {
    type: Number,
    required: true,
  },
  eventType: {
    type: String,
    enum: Object.values(RoomEventType),
    required: true,
  },
  eventVersion: {
    type: Number,
    required: true,
    default: 1,
  },
  actorId: {
    type: String,
  },
  payload: {
    type: Schema.Types.Mixed,
    required: true,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false }, // Events are immutable
});

RoomEventSchema.index({ roomId: 1, sequenceNumber: 1 }, { unique: true });
// For the explicit retention worker
RoomEventSchema.index({ sequenceNumber: 1 });

RoomEventSchema.pre('validate', function(next) {
  if (this.isModified('payload')) {
    try {
      const { validateRoomEventPayload } = require('../utils/eventContracts');
      this.payload = validateRoomEventPayload(this.eventType, this.payload);
      next();
    } catch (err: any) {
      next(err);
    }
  } else {
    next();
  }
});

export const RoomEvent = mongoose.model<RoomEventDoc>('RoomEvent', RoomEventSchema);
