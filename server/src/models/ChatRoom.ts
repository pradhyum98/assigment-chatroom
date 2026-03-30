import mongoose, { Schema, Document } from 'mongoose';

export interface RoomDoc extends Document {
  roomId: string;
  roomName: string;
  avatarColor: string;
  previewText: string;
  createdBy: mongoose.Types.ObjectId;
  participants: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const ChatRoomSchema = new Schema<RoomDoc>(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
    },
    roomName: {
      type: String,
      required: [true, 'Room name is required'],
      trim: true,
      minlength: [2, 'Room name must be at least 2 characters'],
      maxlength: [100, 'Room name cannot exceed 100 characters'],
    },
    avatarColor: {
      type: String,
      default: '#6366f1', // Indigo-500
    },
    previewText: {
      type: String,
      default: 'No messages yet.',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
ChatRoomSchema.index({ createdBy: 1 });

export const ChatRoom = mongoose.model<RoomDoc>('ChatRoom', ChatRoomSchema);
