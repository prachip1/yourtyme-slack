// models/Community.js
const mongoose = require('mongoose');
const communitySchema = new mongoose.Schema({
  channel_id: { type: String, required: true, unique: true },
  channel_name: { type: String },
  members: [{ slackId: String, name: String, city: String }],
  creator: { type: String }
});
module.exports = mongoose.model('Community', communitySchema);