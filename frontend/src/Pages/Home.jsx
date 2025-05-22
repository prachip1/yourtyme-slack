// src/pages/Home.jsx
import React from 'react';

function Home() {
  const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${import.meta.env.VITE_SLACK_CLIENT_ID}&scope=users:read,chat:write,commands,channels:read&user_scope=users:read&redirect_uri=${encodeURIComponent('https://yourtyme-slack-backend.vercel.app/slack/oauth/callback')}`;
  return (
    <div className="home-container">
      <h1>Timezone Tool</h1>
      <p>Connect to Slack to view team timezones!</p>
      <a href={slackAuthUrl}>
        <img
          src="https://api.slack.com/img/sign_in_with_slack.png"
          alt="Add to Slack"
          style={{ width: '200px' }}
        />
      </a>
    <a href="https://slack.com/oauth/v2/authorize?client_id=8817785625495.8829972241173&scope=channels:read,users:read,users.profile:read,commands,app_mentions:read,channels:history,chat:write&redirect_uri=https://yourtyme-slack-backend.vercel.app/slack/oauth/callback&state=12345">Trial Add to Slack</a>
    </div>
  );
}

export default Home;