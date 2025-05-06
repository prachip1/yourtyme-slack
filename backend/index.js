// index.js
const express = require('express');
const dotenv = require('dotenv').config();
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 3000;
const cookieParser = require('cookie-parser');
const axios = require('axios');
const authRoutes = require('./routes/authRoutes');
const { App, ExpressReceiver } = require('@slack/bolt');

// Initialize ExpressReceiver for Slack Bolt
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events',
  app // Pass the Express app directly to the receiver
});

// Initialize Slack Bolt app with the receiver
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

// Database connection
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("db connected"))
  .catch((err) => console.log("not connected", err));

// Middleware setup
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

// CORS setup
const corsOptions = {
  origin: ['http://localhost:5173', 'https://yourtyme-slack.vercel.app'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

// Routes setup
app.use('/', authRoutes);

// Slack OAuth callback
app.get('/slack/oauth/callback', async (req, res) => {
  try {
    const response = await axios.post('https://slack.com/api/oauth.v2.access', {
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code: req.query.code,
      redirect_uri: 'https://yourtyme-slack-backend.vercel.app/slack/oauth/callback'
    });
    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }
    const { access_token, authed_user, team } = response.data;
    if (!authed_user || !authed_user.id) {
      throw new Error('authed_user is missing or invalid in Slack API response');
    }
    await mongoose.model('User').updateOne(
      { slackId: authed_user.id },
      { slackAccessToken: access_token, slackId: authed_user.id, name: authed_user.id, teamId: team.id },
      { upsert: true }
    );
    res.redirect('https://yourtyme-slack.vercel.app/dashboard');
  } catch (error) {
    console.error('OAuth error:', error.message);
    if (error.response) {
      console.error('Slack API response:', error.response.data);
    }
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

// App Home tab
slackApp.event('app_home_opened', async ({ event, client }) => {
  try {
    const user = await mongoose.model('User').findOne({ slackId: event.user });
    const communities = await mongoose.model('Community').find({
      members: { $elemMatch: { slackId: event.user } }
    });

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Timezone Tool' }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: user?.city ? `Your city: ${user.city}` : 'No city set.' }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Set City' },
            action_id: 'set_city'
          }
        ]
      }
    ];

    if (communities.length) {
      for (const community of communities) {
        blocks.push(
          {
            type: 'divider'
          },
          {
            type: 'header',
            text: { type: 'plain_text', text: `#${community.channel_name || community.channel_id}` }
          }
        );
        for (const member of community.members) {
          let timeText = `${member.city || 'No city set'}`;
          if (member.city) {
            try {
              const timeResponse = await axios.get(`https://yourtyme-slack-backend.vercel.app/api/worldtime?city=${member.city}`);
              const { datetime, timezone } = timeResponse.data;
              timeText = `${datetime} (${timezone})`;
            } catch (error) {
              timeText = 'Time unavailable';
            }
          }
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${member.name || member.slackId}*: ${timeText}`
            }
          });
        }
      }
    } else {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: 'Join a channel and set your city to see timezones!' }
      });
    }

    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks
      }
    });
  } catch (error) {
    console.error('App Home error:', error);
  }
});

// Handle set city button
slackApp.action('set_city', async ({ body, ack, client }) => {
  await ack();
  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'set_city_modal',
      title: { type: 'plain_text', text: 'Set Your City' },
      submit: { type: 'plain_text', text: 'Save' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'city',
          element: { type: 'plain_text_input', action_id: 'user_city' },
          label: { type: 'plain_text', text: 'City (e.g., London)' }
        }
      ],
      private_metadata: body.channel_id || ''
    }
  });
});

// Handle city modal submission
slackApp.view('set_city_modal', async ({ view, ack, client }) => {
  await ack();
  const city = view.state.values.city.user_city.value;
  const user_id = view.submitter;
  const channel_id = view.private_metadata;
  try {
    const user = await axios.post('https://yourtyme-slack-backend.vercel.app/slack/addcity', {
      user_id,
      city,
      channel_id
    });

    if (channel_id) {
      await mongoose.model('Community').updateOne(
        { channel_id },
        {
          $addToSet: {
            members: { slackId: user_id, name: user.data.name || user_id, city }
          }
        },
        { upsert: true }
      );
    }

    await client.chat.postMessage({
      channel: user_id,
      text: `City set to ${city}! Check the App Home tab to see timezones.`
    });
  } catch (error) {
    await client.chat.postMessage({
      channel: user_id,
      text: 'Error setting city: ' + (error.response?.data?.error || error.message)
    });
  }
});

// World time API route
app.options('/api/worldtime', cors(corsOptions));
app.get('/api/worldtime', async (req, res) => {
  try {
    const response = await axios.get(`https://api.api-ninjas.com/v1/worldtime?city=${req.query.city}`, {
      headers: { 'X-Api-Key': process.env.API_NINJAS_KEY }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching world time:', error);
    res.status(500).json({ error: 'An error occurred while fetching world time' });
  }
});

// Start Express server
app.listen(PORT, () => {
  console.log(`server is listening to port ${PORT}`);
});

module.exports = app;
module.exports.slackApp = slackApp;