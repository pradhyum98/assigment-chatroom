import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load env variables from the parent .env directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const mongoUri = process.env.MONGODB_URI;

async function run() {
  if (!mongoUri) {
    console.error('CRITICAL: MONGODB_URI is not defined in environment variables.');
    process.exit(1);
  }

  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[MIGRATION] Starting remove_password_recovery migration. Mode: ${isDryRun ? 'DRY RUN' : 'LIVE RUN'}`);

  await mongoose.connect(mongoUri);
  console.log('[MIGRATION] Connected to MongoDB.');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection object is undefined.');
  }

  const usersCollection = db.collection('users');

  // Count users with encryptedPasswordRecovery field
  const count = await usersCollection.countDocuments({ encryptedPasswordRecovery: { $exists: true } });
  console.log(`[MIGRATION] Found ${count} user document(s) containing the 'encryptedPasswordRecovery' field.`);

  const logData = {
    timestamp: new Date().toISOString(),
    dryRun: isDryRun,
    foundCount: count,
    modifiedCount: 0,
    status: 'pending'
  };

  if (count === 0) {
    console.log('[MIGRATION] No users found with encryptedPasswordRecovery. Nothing to clean up.');
    logData.status = 'no_op_success';
  } else if (isDryRun) {
    console.log('[MIGRATION] Dry run: changes would unset encryptedPasswordRecovery from all documents.');
    logData.status = 'dry_run_success';
  } else {
    console.log('[MIGRATION] Unsetting encryptedPasswordRecovery on all documents...');
    const result = await usersCollection.updateMany(
      { encryptedPasswordRecovery: { $exists: true } },
      { $unset: { encryptedPasswordRecovery: '' } }
    );
    console.log(`[MIGRATION] Successfully removed the field from ${result.modifiedCount} document(s).`);
    logData.modifiedCount = result.modifiedCount;
    logData.status = 'live_success';
  }

  // Ensure directories exist
  const logDir = path.resolve(__dirname, '../logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Log to file
  const logFile = path.join(logDir, 'migration_remove_password_recovery.log');
  fs.appendFileSync(logFile, JSON.stringify(logData) + '\n', 'utf-8');
  console.log(`[MIGRATION] Results logged to ${logFile}`);

  await mongoose.disconnect();
  console.log('[MIGRATION] Disconnected from MongoDB. Completed.');
}

run().catch((err) => {
  console.error('[MIGRATION] Execution failed:', err);
  process.exit(1);
});
