const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  slackId: { type: String, required: true, unique: true },
  slackAccessToken: { type: String },
  name: { type: String },
  city: { type: String },
  teamId: { type: String }, // Add teamId field
});
module.exports = mongoose.model('User', userSchema);