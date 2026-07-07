import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { User } from '../models/User';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const runMigration = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('CRITICAL: MONGODB_URI is not defined in environment variables.');
    process.exit(1);
  }

  try {
    console.log('[Migration] Connecting to database...');
    await mongoose.connect(mongoUri);
    console.log('[Migration] Database connection successful.');

    console.log('[Migration] Removing legacy encryptedPasswordRecovery fields...');
    const result = await User.updateMany(
      {},
      { $unset: { encryptedPasswordRecovery: 1 } }
    );

    console.log(`[Migration] Success. Matches: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
    process.exit(0);
  } catch (err) {
    console.error('[Migration] Failed to complete database migration:', err);
    process.exit(1);
  }
};

runMigration();
