const { App } = require('@slack/bolt');
const app = new App({
  token: process.env.SLACK_BOT_TOKEN, // From OAuth & Permissions
  signingSecret: process.env.SLACK_SIGNING_SECRET, // From Basic Information
  socketMode: true, // Optional for local development
  appToken: process.env.SLACK_APP_TOKEN // Required for socket mode
});
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('Slack app running!');
})();