import mongoose, { Document, Schema } from 'mongoose';

export interface ICallLog extends Document {
  roomId: string;
  callerId: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  callType: 'audio' | 'video';
  status: 'completed' | 'missed' | 'rejected' | 'cancelled';
  startedAt: Date;
  endedAt?: Date;
  duration?: number; // in seconds
}

const callLogSchema = new Schema<ICallLog>(
  {
    roomId: { type: String, required: true, index: true },
    callerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    callType: { type: String, enum: ['audio', 'video'], required: true },
    status: { type: String, enum: ['completed', 'missed', 'rejected', 'cancelled'], required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
    duration: { type: Number },
  },
  { timestamps: true }
);

export const CallLog = mongoose.model<ICallLog>('CallLog', callLogSchema);
