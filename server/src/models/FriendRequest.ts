import mongoose, { Schema, Document } from 'mongoose';

export interface FriendRequestDoc extends Document {
  sender: mongoose.Types.ObjectId;
  recipient: mongoose.Types.ObjectId;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

const FriendRequestSchema = new Schema<FriendRequestDoc>(
  {
    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for security and speed
// Unique index to prevent duplicate request records in the same direction
FriendRequestSchema.index({ sender: 1, recipient: 1 }, { unique: true });
FriendRequestSchema.index({ recipient: 1, status: 1 });

export const FriendRequest = mongoose.model<FriendRequestDoc>('FriendRequest', FriendRequestSchema);
