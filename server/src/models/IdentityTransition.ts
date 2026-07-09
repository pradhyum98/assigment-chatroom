import mongoose, { Schema, Document } from 'mongoose';

export interface IdentityTransitionDoc extends Document {
  userId: mongoose.Types.ObjectId;
  roomId: mongoose.Types.ObjectId;
  previousIdentityVersion: number;
  newIdentityVersion: number;
  requiredMembershipRevision: number;
  previousRoomKeyVersion: number;
  resolvedRoomKeyVersion?: number;
  failureReason?: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  createdAt: Date;
  updatedAt: Date;
}

const IdentityTransitionSchema = new Schema<IdentityTransitionDoc>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    roomId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatRoom',
      required: true,
      index: true,
    },
    previousIdentityVersion: {
      type: Number,
      required: true,
    },
    newIdentityVersion: {
      type: Number,
      required: true,
    },
    requiredMembershipRevision: {
      type: Number,
      required: true,
    },
    previousRoomKeyVersion: {
      type: Number,
      required: true,
    },
    resolvedRoomKeyVersion: {
      type: Number,
    },
    failureReason: {
      type: String,
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for finding pending transitions for a specific user in a specific room
IdentityTransitionSchema.index({ userId: 1, roomId: 1, status: 1 });

export const IdentityTransition = mongoose.model<IdentityTransitionDoc>(
  'IdentityTransition',
  IdentityTransitionSchema
);
