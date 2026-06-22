import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import connectDB from './config/db';
import authRoutes from './routes/auth';
import roomRoutes from './routes/rooms';
import messageRoutes from './routes/messages';
import friendsRoutes from './routes/friends';
import uploadRoutes from './routes/upload';
import path from 'path';
import { authenticate } from './middleware/auth';
import { logger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import { setupSocketHandlers } from './socket/socketHandlers';
import { preventNoSqlInjection } from './middleware/validation';
import { authLimiter, generalLimiter } from './middleware/rateLimiter';

import { requestLogger } from './middleware/requestLogger';

dotenv.config();

// Fail fast on startup if environment variables are missing
if (!process.env.JWT_SECRET) {
  logger.error('CRITICAL: JWT_SECRET environment variable is missing.');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  logger.error('CRITICAL: MONGODB_URI environment variable is missing.');
  process.exit(1);
}

const app = express();
const server = createServer(app);

// Strict CORS config for Express
const allowedOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
const corsOptions = {
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(helmet());
app.use(express.json({ limit: '10kb' })); // Restrict JSON payload sizes to prevent Denial of Service (DoS)
app.use(cors(corsOptions));
app.use(preventNoSqlInjection); // Global check to prevent NoSQL query operator injection
app.use(requestLogger);

// Strict CORS config for Socket.IO
const io = new Server(server, {
  cors: corsOptions,
});

connectDB();
setupSocketHandlers(io);

// Mount rate limiters securely to relevant endpoints
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/rooms', generalLimiter, roomRoutes);
app.use('/api/messages', generalLimiter, messageRoutes);
app.use('/api/friends', generalLimiter, friendsRoutes);
app.use('/api/upload', generalLimiter, uploadRoutes);

// Serve the uploads directory statically (gated by authenticate middleware)
app.use('/uploads', authenticate, express.static(path.join(__dirname, '../uploads')));

// Simple health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Error Handling Middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5001;
// Start the server listener
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
