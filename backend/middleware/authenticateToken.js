// middleware/authenticateToken.js
const User = require('../models/User');

const authenticateToken = async (req, res, next) => {
  const slackId = req.headers['x-slack-user-id'] || req.body.user_id;
  if (!slackId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = await User.findOne({ slackId });
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  req.user = { slackId };
  next();
};

module.exports = authenticateToken;