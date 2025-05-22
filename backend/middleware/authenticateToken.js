const { db } = require('../firebase');

const authenticateToken = async (req, res, next) => {
  const slackId = req.headers['x-slack-user-id'] || req.body.user_id || req.query.user_id;
  if (!slackId) {
    console.error('authenticateToken: Missing slackId in headers, body, or query');
    return res.status(401).json({ error: 'Unauthorized: Missing Slack user ID' });
  }
  try {
    const userDoc = await db.collection('users').doc(slackId).get();
    if (!userDoc.exists) {
      console.error(`authenticateToken: User not found for slackId: ${slackId}`);
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = { slackId };
    next();
  } catch (error) {
    console.error(`authenticateToken: Error for slackId ${slackId}:`, error.message);
    return res.status(500).json({ error: 'Server error during authentication' });
  }
};

module.exports = authenticateToken;