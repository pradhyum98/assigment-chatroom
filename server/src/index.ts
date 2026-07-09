import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import connectDB from './config/db';
import authRoutes from './routes/auth';
import roomRoutes from './routes/rooms';
import groupRoutes from './routes/groups';
import searchRoutes from './routes/search';
import messageRoutes from './routes/messages';
import friendsRoutes from './routes/friends';
import uploadRoutes from './routes/upload';
import callRoutes from './routes/calls';
import webrtcRoutes from './routes/webrtc';
import notificationsRoutes from './routes/notifications';
import syncRoutes from './routes/sync';
import path from 'path';
import { authenticate } from './middleware/auth';
import { logger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import { preventNoSqlInjection } from './middleware/validation';
import { authLimiter, generalLimiter } from './middleware/rateLimiter';
import { initIo } from './socket';

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

// Fail fast if dev reset tokens are exposed in production
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_RESET_TOKEN_RESPONSE === 'true') {
  logger.error('CRITICAL: ALLOW_DEV_RESET_TOKEN_RESPONSE is not allowed in production mode.');
  process.exit(1);
}

const app = express();
// REQUIRED for express-rate-limit when deployed behind a reverse proxy (Render, Vercel, Heroku, etc.)
// Otherwise, req.ip will be the load balancer's IP and every user will share the same rate limit!
app.set('trust proxy', 1);

const server = createServer(app);

// CLIENT_URL supports comma-separated list: e.g. "https://yourapp.onrender.com,https://localhost"
const allowedOrigins = [
  ...(process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean),
  'https://localhost',
  'http://localhost',
  'http://localhost:5173',
];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) {
      callback(null, true);
      return;
    }
    // Allow Capacitor native origins
    if (origin.startsWith('capacitor://') || origin.startsWith('ionic://')) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`[CORS] Rejected origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "http:", "https:"],
      mediaSrc: ["'self'", "blob:", "http:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:", "http:", "https:"],
    },
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: '10kb' })); // Restrict JSON payload sizes to prevent Denial of Service (DoS)
app.use(compression()); // Compress responses
app.use(cors(corsOptions));
app.use(preventNoSqlInjection); // Global check to prevent NoSQL query operator injection
app.use(requestLogger);

// Strict CORS config for Socket.IO
initIo(server, corsOptions);

connectDB();

// Mount rate limiters securely to relevant endpoints
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/rooms', generalLimiter, roomRoutes);
app.use('/api/groups', generalLimiter, groupRoutes);
app.use('/api/search', generalLimiter, searchRoutes);
app.use('/api/rooms', generalLimiter, callRoutes);
app.use('/api/calls', generalLimiter, webrtcRoutes);
app.use('/api/messages', generalLimiter, messageRoutes);
app.use('/api/friends', generalLimiter, friendsRoutes);
app.use('/api/upload', generalLimiter, uploadRoutes);
app.use('/api/notifications', generalLimiter, notificationsRoutes);
app.use('/api/sync', generalLimiter, syncRoutes);

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
