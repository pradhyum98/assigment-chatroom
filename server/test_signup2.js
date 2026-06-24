const mongoose = require('mongoose');
const { User } = require('./dist/models/User'); 
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    try {
      console.log('Connected. Attempting to create user 2...');
      const user = await User.create({
        firstName: 'Test2',
        lastName: 'User2',
        email: 'test2@example.com',
        password: 'password123',
        privacyLastSeen: 'everyone',
        privacyOnlineStatus: 'everyone'
      });
      console.log('User created:', user._id);
    } catch (e) {
      console.log('Error creating user:', e);
    }
    process.exit(0);
  });
