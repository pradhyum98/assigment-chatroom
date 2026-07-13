const mongoose = require('mongoose');
const { User } = require('./dist/models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    const user = await User.findOne({ email: 'u1@test.com' }).populate('friends');
    console.log("USER:", user);
    process.exit(0);
  });

