import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/db';
import { ChatRoom } from './models/ChatRoom';
import { User } from './models/User';

async function listAll() {
  await connectDB();
  console.log('Connected to MongoDB.');

  const users = await User.find({});
  console.log(`--- Users (${users.length}) ---`);
  for (const u of users) {
    console.log(`ID: ${u._id} | Name: ${u.firstName} ${u.lastName} | Email: ${u.email}`);
  }

  const rooms = await ChatRoom.find({});
  console.log(`--- Rooms (${rooms.length}) ---`);
  for (const r of rooms) {
    console.log(`ID: ${r.roomId} | DM: ${r.isDM} | Group: ${!r.isDM} | Name: ${r.roomName} | Participants: ${r.participants.join(', ')}`);
  }

  process.exit(0);
}

listAll().catch(err => {
  console.error(err);
  process.exit(1);
});
