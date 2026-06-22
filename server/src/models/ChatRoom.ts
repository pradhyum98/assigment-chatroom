import mongoose, { Schema, Document } from 'mongoose';

export interface RoomDoc extends Document {
  roomId: string;
  roomName?: string;
  avatarColor: string;
  avatarUrl?: string;
  previewText: string;
  description?: string;
  createdBy: mongoose.Types.ObjectId;
  participants: mongoose.Types.ObjectId[];
  admins: mongoose.Types.ObjectId[];
  isDM: boolean;
  isPrivate: boolean;
  lastMessage?: mongoose.Types.ObjectId;
  pinnedMessages: mongoose.Types.ObjectId[];
  unreadCounts: Map<string, number>;
  encryptedRoomKeys: Map<string, string>;
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
      required: [
        function (this: any) {
          return !this.isDM;
        },
        'Room name is required for non-DM rooms',
      ],
      trim: true,
      minlength: [2, 'Room name must be at least 2 characters'],
      maxlength: [100, 'Room name cannot exceed 100 characters'],
    },
    avatarColor: {
      type: String,
      default: '#6366f1', // Indigo-500
    },
    avatarUrl: {
      type: String,
      default: undefined,
    },
    previewText: {
      type: String,
      default: 'No messages yet.',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters'],
      default: undefined,
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
    // Group admin roles (Phase 6) — creator is always an admin on creation
    admins: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isDM: {
      type: Boolean,
      default: false,
    },
    isPrivate: {
      type: Boolean,
      default: true,
    },
    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
    },
    // Pinned messages (Phase 6)
    pinnedMessages: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Message',
      },
    ],
    // Per-user unread message counter: userId (string) → count
    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },
    // E2EE: participantId (string) -> encrypted base64 room key
    encryptedRoomKeys: {
      type: Map,
      of: String,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

ChatRoomSchema.index({ participants: 1 });
ChatRoomSchema.index({ isDM: 1 });
ChatRoomSchema.index({ createdBy: 1 });

// Database-level DM uniqueness constraint to prevent concurrent duplicate creation
ChatRoomSchema.index(
  { participants: 1 },
  { unique: true, partialFilterExpression: { isDM: true } }
);

export const ChatRoom = mongoose.model<RoomDoc>('ChatRoom', ChatRoomSchema);
