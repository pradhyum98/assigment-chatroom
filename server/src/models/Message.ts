import mongoose, { Schema, Document } from 'mongoose';

// ─── Sub-document interfaces ───────────────────────────────────────────────────

export interface Reaction {
  emoji: string;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
}

export interface ReadReceipt {
  userId: mongoose.Types.ObjectId;
  readAt: Date;
}

export interface DeliveryReceipt {
  userId: mongoose.Types.ObjectId;
  deliveredAt: Date;
}

// ─── Message types ─────────────────────────────────────────────────────────────

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'voice';

// ─── Main document interface ───────────────────────────────────────────────────

export interface MessageDoc extends Document {
  messageId: string;
  senderId: mongoose.Types.ObjectId;
  senderName: string;
  roomId: string;

  // Content
  type: MessageType;
  content: string;
  timestamp: Date;

  // Media (Phase 2 - fields present now for forward-compat)
  mediaUrl?: string;
  mediaFilename?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  thumbnailUrl?: string;

  // Threading
  replyTo?: mongoose.Types.ObjectId;

  // Edit / delete
  editedAt?: Date;
  deletedAt?: Date;
  deletedForEveryone: boolean;

  // Reactions: array of { emoji, userId }
  reactions: Reaction[];

  // Delivery / read status
  deliveredTo: DeliveryReceipt[];
  readBy: ReadReceipt[];
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const ReactionSchema = new Schema<Reaction>(
  {
    emoji:     { type: String, required: true, maxlength: 10 },
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ReadReceiptSchema = new Schema<ReadReceipt>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    readAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const DeliveryReceiptSchema = new Schema<DeliveryReceipt>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deliveredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const MessageSchema = new Schema<MessageDoc>(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    roomId: {
      type: String,
      required: true,
      index: true,
    },

    // ── Content ──────────────────────────────────────────────────────────────
    type: {
      type: String,
      enum: ['text', 'image', 'video', 'audio', 'file', 'voice'],
      default: 'text',
      required: true,
    },
    content: {
      type: String,
      required: [
        function (this: MessageDoc) { return this.type === 'text' || this.type === 'voice'; },
        'Message content is required for text/voice messages',
      ],
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters'],
      default: '',
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },

    // ── Media (populated by Phase 2 upload controller) ────────────────────────
    mediaUrl:       { type: String },
    mediaFilename:  { type: String, maxlength: 255 },
    mediaMimeType:  { type: String, maxlength: 100 },
    mediaSize:      { type: Number, min: 0 },
    thumbnailUrl:   { type: String },

    // ── Threading ─────────────────────────────────────────────────────────────
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: undefined,
    },

    // ── Edit / delete ─────────────────────────────────────────────────────────
    editedAt:           { type: Date, default: undefined },
    deletedAt:          { type: Date, default: undefined },
    deletedForEveryone: { type: Boolean, default: false },

    // ── Reactions ─────────────────────────────────────────────────────────────
    reactions: {
      type: [ReactionSchema],
      default: [],
    },

    // ── Receipts ──────────────────────────────────────────────────────────────
    deliveredTo: {
      type: [DeliveryReceiptSchema],
      default: [],
    },
    readBy: {
      type: [ReadReceiptSchema],
      default: [],
    },
  },
  {
    timestamps: false,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Compound index for efficient room message retrieval with cursor-based pagination
MessageSchema.index({ roomId: 1, timestamp: -1 });

// Index for soft-delete queries (exclude deleted messages efficiently)
MessageSchema.index({ roomId: 1, deletedForEveryone: 1, timestamp: -1 });

// Full-text search index for Phase 8 search feature
MessageSchema.index({ content: 'text' });

// ─── Export ───────────────────────────────────────────────────────────────────

export const Message = mongoose.model<MessageDoc>('Message', MessageSchema);
