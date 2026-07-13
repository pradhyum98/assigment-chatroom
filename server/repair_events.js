const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/securechat';

const UserEventSchema = new mongoose.Schema({
  userId: String,
  sequenceNumber: Number,
  eventType: String,
  eventVersion: Number,
  payload: mongoose.Schema.Types.Mixed,
  createdAt: Date
}, { collection: 'userevents' });

const ChatRoomSchema = new mongoose.Schema({
  roomId: String,
  roomName: String,
  avatarColor: String,
  previewText: String,
  participants: [mongoose.Schema.Types.ObjectId],
  isDM: Boolean,
  isPrivate: Boolean,
  roomKeyVersion: Number,
  membershipRevision: Number,
  encryptedRoomKeys: {
    type: Map,
    of: new mongoose.Schema({
      encryptedKey: String,
      identityVersion: Number
    }, { _id: false })
  }
}, { collection: 'chatrooms' });

const UserEvent = mongoose.model('UserEvent', UserEventSchema);
const ChatRoom = mongoose.model('ChatRoom', ChatRoomSchema);

async function repair() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  const events = await UserEvent.find({ eventType: 'ROOM_ACCESS_GRANTED' });
  console.log(`Found ${events.length} ROOM_ACCESS_GRANTED events.`);

  for (const event of events) {
    const roomId = event.payload?.roomId;
    if (!roomId) {
      console.warn(`Event ${event._id} has no roomId in payload.`);
      continue;
    }

    const room = await ChatRoom.findOne({ roomId });
    if (!room) {
      console.warn(`Room ${roomId} not found for event ${event._id}.`);
      continue;
    }

    console.log(`Updating event ${event._id} (seq: ${event.sequenceNumber}) for room ${roomId}`);
    
    event.payload = {
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
    };

    event.markModified('payload');
    await event.save();
  }

  console.log('Repair complete!');
  process.exit(0);
}

repair().catch(err => {
  console.error(err);
  process.exit(1);
});
