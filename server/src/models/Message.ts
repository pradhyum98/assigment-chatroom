import mongoose, { Schema, Document } from 'mongoose';

export interface MessageDoc extends Document {
  messageId: string;
  senderId: mongoose.Types.ObjectId;
  senderName: string;
  roomId: string;
  content: string;
  timestamp: Date;
}

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
    },
    roomId: {
      type: String,
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: [true, 'Message content is required'],
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters'],
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

// Compound index for efficient room message retrieval
MessageSchema.index({ roomId: 1, timestamp: -1 });

export const Message = mongoose.model<MessageDoc>('Message', MessageSchema);
