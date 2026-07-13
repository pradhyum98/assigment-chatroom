const mongoose = require('mongoose');
const { User } = require('./dist/models/User'); 
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    try {
      console.log('Connected to MongoDB. Fetching users...');
      const users = await User.find({});
      if (users.length < 2) {
        console.log('Not enough users to make friends.');
        process.exit(0);
      }

      console.log(`Found ${users.length} users. Linking everyone as friends...`);
      for (const user of users) {
        const otherUserIds = users
          .filter(u => u._id.toString() !== user._id.toString())
          .map(u => u._id);
        
        user.friends = otherUserIds;
        await user.save();
        console.log(`Updated friends for ${user.email} -> ${otherUserIds.join(', ')}`);
      }
      console.log('Successfully linked all users as friends!');
    } catch (e) {
      console.log('Error making friends:', e);
    }
    process.exit(0);
  });
