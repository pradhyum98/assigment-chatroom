import mongoose, { Schema, Document } from 'mongoose';

export interface ProcessedMutationDoc extends Document {
  mutationId: string;
  roomId?: string;
  userId?: string;
  type: string;
  createdAt: Date;
}

const ProcessedMutationSchema = new Schema<ProcessedMutationDoc>(
  {
    mutationId: {
      type: String,
      required: true,
      unique: true,
    },
    roomId: {
      type: String,
    },
    userId: {
      type: String,
    },
    type: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const ProcessedMutation = mongoose.model<ProcessedMutationDoc>('ProcessedMutation', ProcessedMutationSchema);
