import mongoose, { Schema, Document } from 'mongoose';

export interface UserSequenceDoc extends Document {
  userId: string;
  currentSequence: number;
}

const UserSequenceSchema = new Schema<UserSequenceDoc>({
  userId: {
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

export const UserSequence = mongoose.model<UserSequenceDoc>('UserSequence', UserSequenceSchema);
