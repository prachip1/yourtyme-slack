const { createHmac } = require('crypto');

const slackAuth = (req, res, next) => {
  if (!process.env.SLACK_SIGNING_SECRET) {
    console.error('slackAuth: SLACK_SIGNING_SECRET not set in environment');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSignature = req.headers['x-slack-signature'];
  let body;
  try {
    body = JSON.stringify(req.body || {});
  } catch (error) {
    console.error('slackAuth: Failed to stringify request body:', error.message);
    return res.status(400).json({ error: 'Invalid request body' });
  }

  if (!timestamp || !slackSignature) {
    console.error('slackAuth: Missing Slack headers', { timestamp, slackSignature });
    return res.status(401).json({ error: 'Missing Slack headers' });
  }

  const time = Math.floor(new Date().getTime() / 1000);
  if (Math.abs(time - timestamp) > 60 * 5) {
    console.error('slackAuth: Request timestamp too old', { timestamp, currentTime: time });
    return res.status(401).json({ error: 'Request timestamp is too old' });
  }

  const sigBaseString = `v0:${timestamp}:${body}`;
  const computedSignature = 'v0=' + createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(sigBaseString)
    .digest('hex');

  if (computedSignature !== slackSignature) {
    console.error('slackAuth: Invalid Slack signature', { computedSignature, slackSignature });
    return res.status(401).json({ error: 'Invalid Slack signature' });
  }

  const slackId = req.body.user_id || req.body.payload?.user?.id;
  if (!slackId) {
    console.error('slackAuth: Missing slackId in request body');
    return res.status(401).json({ error: 'Unauthorized: Missing Slack user ID' });
  }

  req.user = { slackId };
  next();
};

module.exports = slackAuth;