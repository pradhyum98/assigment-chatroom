import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from './config/db';
import { ChatRoom } from './models/ChatRoom';
import { UserEvent, UserEventType } from './models/UserEvent';
import { SequenceService } from './services/SequenceService';

async function backfill() {
  await connectDB();
  console.log('Connected to MongoDB.');

  const rooms = await ChatRoom.find({ isDM: true });
  console.log(`Found ${rooms.length} DM rooms.`);

  for (const room of rooms) {
    console.log(`Processing room ${room.roomId} (participants: ${room.participants.join(', ')})`);
    
    for (const participantId of room.participants) {
      const pIdStr = participantId.toString();
      
      // Check if event already exists
      const existingEvent = await UserEvent.findOne({
        userId: pIdStr,
        eventType: UserEventType.ROOM_ACCESS_GRANTED,
        'payload.roomId': room.roomId
      });

      if (existingEvent) {
        console.log(`Event already exists for participant ${pIdStr} in room ${room.roomId}. Skipping.`);
        continue;
      }

      console.log(`Backfilling ROOM_ACCESS_GRANTED for participant ${pIdStr} in room ${room.roomId}`);
      const sequenceNumber = await SequenceService.allocateUserSequence(pIdStr, 1);
      
      await UserEvent.create({
        userId: pIdStr,
        sequenceNumber,
        eventType: UserEventType.ROOM_ACCESS_GRANTED,
        eventVersion: 1,
        payload: {
          roomId: room.roomId,
          roomKeyVersion: room.roomKeyVersion || 1,
          membershipRevision: room.membershipRevision || 1,
          roomName: room.roomName,
          isDM: room.isDM,
          isPrivate: room.isPrivate,
          avatarColor: room.avatarColor,
          previewText: room.previewText,
          participants: room.participants.map(p => p.toString()),
          encryptedRoomKeys: room.encryptedRoomKeys ? Object.fromEntries(room.encryptedRoomKeys) : {},
        }
      });
      console.log(`Successfully created event with sequence ${sequenceNumber}`);
    }
  }

  console.log('Backfill complete!');
  process.exit(0);
}

backfill().catch(err => {
  console.error(err);
  process.exit(1);
});
