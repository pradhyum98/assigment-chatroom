import mongoose from 'mongoose';
import { logger } from '../middleware/logger';

/**
 * Configures and initiates the MongoDB connection.
 * Strictly requires MONGODB_URI for persistence. Fails fast if connection is unavailable.
 */
const connectDB = async (): Promise<void> => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    logger.error('CRITICAL: MONGODB_URI is not defined in environment variables.');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000, // Fail fast if Atlas is unreachable
    });

    logger.info('Connected to MongoDB Atlas');
  } catch (error: any) {
    logger.error('Database connection failed:', error.message);
    process.exit(1);
  }
};

export default connectDB;
