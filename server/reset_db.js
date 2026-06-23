require('dotenv').config();
const mongoose = require('mongoose');

async function resetDB() {
  try {
    console.log('Connecting to MongoDB...', process.env.MONGODB_URI);
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    const collections = await mongoose.connection.db.collections();
    
    for (let collection of collections) {
      console.log(`Dropping collection: ${collection.collectionName}`);
      await collection.drop();
    }
    
    console.log('✅ Database successfully wiped clean.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  }
}

resetDB();
