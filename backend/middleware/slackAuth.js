// middleware/slackAuth.js
const { createHmac } = require('crypto');

const slackAuth = (req, res, next) => {
  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSignature = req.headers['x-slack-signature'];
  const body = JSON.stringify(req.body);

  if (!timestamp || !slackSignature) {
    return res.status(401).json({ error: 'Missing Slack headers' });
  }

  const time = Math.floor(new Date().getTime() / 1000);
  if (Math.abs(time - timestamp) > 60 * 5) {
    return res.status(401).json({ error: 'Request timestamp is too old' });
  }

  const sigBaseString = `v0:${timestamp}:${body}`;
  const computedSignature = 'v0=' + createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(sigBaseString)
    .digest('hex');

  if (computedSignature !== slackSignature) {
    return res.status(401).json({ error: 'Invalid Slack signature' });
  }

  req.user = { slackId: req.body.user_id };
  next();
};

module.exports = slackAuth;