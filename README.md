# Secure Real-Time Chat & Sharing PWA

A high-performance, secure, real-time Progressive Web Application (PWA) built with React, Redux, Node.js, Socket.IO, and MongoDB, featuring client-side end-to-end encryption (E2EE), deterministic incremental synchronization, offline queueing via IndexedDB, and chunked resumable media uploads.

---

## 1. System Architecture Diagram

```mermaid
flowchart TD
    subgraph Client Application (PWA Browser / OS Sandbox)
        UI[React 18 Component Tree] <--> Redux[Redux Toolkit Store]
        Redux <--> SM[SyncManager Coordinator]
        SM <--> IDB[(IndexedDB Storage: Queue & Checkpoints)]
        SM <--> CS[CryptoService E2EE: AES-GCM / RSA-OAEP]
        SM <--> Api[Axios API Client]
        SM <--> Socket[Socket.IO Client]
        SW[Service Worker: Network-First Cache Shell]
    end

    subgraph Backend Services (Node.js Express / Socket.IO Cluster)
        Server[Express App Server] <--> Auth[JWT Authentication Gate]
        SocketIO[Socket.IO Event Gateway] <--> ChannelManager[Room Room / Channel Auto-Join]
        UploadController[Chunked Upload Handler] <--> DiskStorage[uploads/chunks Temporary Assembly]
    end

    subgraph Database Layer (MongoDB Cluster)
        Mongo[(MongoDB Atlas)]
        MongoIndex[Compound Indexes: roomId_1_id_1]
    end

    Api <--> Server
    Socket <--> SocketIO
    Server <--> Mongo
    SocketIO <--> Mongo
```

---

## 2. Environment Variables Reference

### Backend Configuration (`server/.env`)
Create a `.env` file inside the `server/` directory:

| Variable | Description | Example Value |
| :--- | :--- | :--- |
| `PORT` | Local network port for the server. | `5001` |
| `MONGO_URI` | MongoDB Connection URI string. | `mongodb+srv://user:pass@cluster.mongodb.net/dbname` |
| `JWT_SECRET` | Secret key used for signing session auth JSON Web Tokens. | `super_secure_auth_jwt_key_hash_128` |
| `VAPID_PUBLIC_KEY` | VAPID key pair public key for push notifications. | `BEl69...` |
| `VAPID_PRIVATE_KEY`| VAPID key pair private key for push notifications. | `sFS82...` |

### Frontend Configuration (`client/.env`)
Create a `.env` file inside the `client/` directory:

| Variable | Description | Example Value |
| :--- | :--- | :--- |
| `VITE_API_URL` | Base HTTP endpoint URL of the backend API. | `http://localhost:5001/api` |
| `VITE_SOCKET_URL`| Base WebSocket endpoint URL of the Socket.IO server. | `http://localhost:5001` |

---

## 3. Resumable Chunked Upload & Sync Internals

### Deterministic Incremental Sync
When the PWA recovers from an offline state or foregrounds:
1. `SyncManager` queries the Redux store for the active chat and determines the last message containing a valid MongoDB database ID (`_id`).
2. It requests `/api/messages/:roomId?sinceId=<lastObjectId>` from the backend.
3. Because MongoDB ObjectIds are generated chronologically, the server does a high-speed indexed scan (optimized by index `{ roomId: 1, _id: 1 }`) and returns only missing messages, avoiding clock-skew bugs and full conversation re-fetches.

### Chunked Upload Slicing
Files are sliced into `1MB` binary blobs, encrypted using client-side AES-GCM, and sent sequentially to the server:
* `POST /api/upload/initiate`: Creates a chunks directory on disk and registers file metadata (`filename`, `mimetype`, `size`).
* `GET /api/upload/status`: Polls progress, letting the client resume an interrupted upload from the exact missing chunk index.
* `POST /api/upload/chunk`: Uploads a single slice. Once all chunks are present on disk, the server aggregates and merges them sequentially in FIFO order.

---

## 4. Run Locally

### 1. Start Backend Server
```bash
cd server
npm install
npm run build
npm run dev
```

### 2. Start Client Web Application
```bash
cd client
npm install
npm run build
npm run dev
```
Open `http://localhost:5173` to access the chat application interface.

---

## 5. Production Build & Deployment

### Build Compilation
Prior to deploying, compile both the frontend and backend to verify strict TypeScript typing:
```bash
# Compile server
cd server && npm run build

# Compile client
cd client && npm run build
```

### Hosting Recommendations
* **Frontend PWA**: Deploy to static CDNs such as Netlify or Vercel. Ensure `manifest.json` headers are correctly set.
* **Backend Server**: Deploy on Render, AWS EC2, or Heroku. Ensure WebSockets are enabled on the host balancer.
* **Database**: MongoDB Atlas Cluster with proper network access rules.

---

## 6. Backup, Recovery & Upgrade Procedures

### Database Backups (MongoDB)
Schedule regular backups of database collections to secure user channels and messages:
```bash
# Export database collection backup
mongodump --uri="mongodb+srv://user:pass@cluster.mongodb.net/dbname" --out=/backups/$(date +%F)

# Restore database collection backup
mongorestore --uri="mongodb+srv://user:pass@cluster.mongodb.net/dbname" /backups/2026-06-30/
```

### Upgrading the Application (Zero Downtime)
1. Deploy the backend server build first (backward compatible with older clients).
2. Deploy the new client bundle. The Service Worker will fetch `index.html` via Network-First, identify changed asset hashes, register the update, and automatically trigger `self.skipWaiting()` and `clients.claim()` on reload to update client tabs immediately.
