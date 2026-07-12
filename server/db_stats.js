const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    const stats = await db.command({ dbStats: 1 });
    console.log('--- DATABASE STATS ---');
    console.log(`Database name: ${stats.db}`);
    console.log(`Collections count: ${stats.collections}`);
    console.log(`Data size: ${(stats.dataSize / 1024 / 1024).toFixed(3)} MB`);
    console.log(`Storage size: ${(stats.storageSize / 1024 / 1024).toFixed(3)} MB`);
    console.log(`Index size: ${(stats.indexSize / 1024 / 1024).toFixed(3)} MB`);
    
    // Check files and chunks count
    const filesCount = await db.collection('encrypted_media.files').countDocuments();
    const chunksCount = await db.collection('encrypted_media.chunks').countDocuments();
    console.log(`GridFS Files count: ${filesCount}`);
    console.log(`GridFS Chunks count: ${chunksCount}`);
    
    await mongoose.connection.close();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
