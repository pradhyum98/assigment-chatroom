# Real-Time Chatroom

Hey there! This is a real-time chat app I built using Node.js, Socket.IO, and React. It's got everything you'd expect—instant messaging, rooms, and a clean UI that actually works.

I built this focused on keeping things snappy and reliable. The backend uses Express and MongoDB Atlas for keeping the messages safe, and the frontend uses Redux to keep the UI in sync. Check out the **"project Alpha"** group to see the latest sync in action.

### What's inside:
- **Instant Messaging**: Messages show up as soon as they're sent—no refreshing needed.
- **Rooms**: You can create any room you want and start chatting.
- **Login/Signup**: Standard JWT-based auth to keep things secure.
- **Mobile Friendly**: Looks good on both web and mobile.

### Tech Stuff:
- **Frontend**: React 18, Redux, Socket.io-client.
- **Backend**: Node.js, Express, Socket.IO, Mongoose.
- **Database**: MongoDB Atlas.

### How to run it locally:
1. Clone it.
2. `cd server` -> `npm install` -> `npm run dev` (Setup your `.env` with a Mongo URI first!)
3. `cd client` -> `npm install` -> `npm run dev`

### A note on Deployment:
If you're deploying this on Vercel and Render, just make sure your environment variables (`VITE_API_URL` and `VITE_SOCKET_URL`) are pointing to the correct backend host. Otherwise, the real-time stuff won't connect properly.

---
Created by Pradhyum Upadhyay.
