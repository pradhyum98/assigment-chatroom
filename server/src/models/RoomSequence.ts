import mongoose, { Schema, Document } from 'mongoose';

export interface RoomSequenceDoc extends Document {
  roomId: string;
  currentSequence: number;
}

const RoomSequenceSchema = new Schema<RoomSequenceDoc>({
  roomId: {
    type: String,
    required: true,
    unique: true,
  },
  currentSequence: {
    type: Number,
    required: true,
    default: 0,
  }
});

export const RoomSequence = mongoose.model<RoomSequenceDoc>('RoomSequence', RoomSequenceSchema);
