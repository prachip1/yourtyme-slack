const express = require('express');
const dotenv = require('dotenv').config();
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 8080;
const cookieParser = require('cookie-parser');
const axios = require('axios');
const authRoutes = require('./routes/authRoutes');
const { App, ExpressReceiver } = require('@slack/bolt');
const User = require('./models/User');
const Community = require('./models/Community');

// Initialize ExpressReceiver for Slack Bolt
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events',
  app,
});

// Initialize Slack Bolt app with the receiver
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Database connection
const connectToDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      w: 'majority',
    });
    console.log('db connected');
  } catch (err) {
    console.error('not connected', err);
    process.exit(1);
  }
};

// Middleware setup
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

// CORS setup
const corsOptions = {
  origin: ['http://localhost:5173', 'https://yourtyme-slack.vercel.app'],
  credentials: true,
  optionsSuccessStatus: 200,
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

// App Home tab
slackApp.event('app_home_opened', async ({ event, client }) => {
  try {
    const user = await User.findOne({ slackId: event.user });
    const communities = await Community.find({
      members: { $elemMatch: { slackId: event.user } },
    });

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Timezone Tool' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: user?.city ? `Your city: ${user.city}` : 'No city set.' },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Set City' },
            action_id: 'set_city',
          },
        ],
      },
    ];

    if (communities.length) {
      for (const community of communities) {
        blocks.push(
          {
            type: 'divider',
          },
          {
            type: 'header',
            text: { type: 'plain_text', text: `#${community.channel_name || community.channel_id}` },
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
              text: `*${member.name || member.slackId}*: ${timeText}`,
            },
          });
        }
      }
    } else {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: 'Join a channel and set your city to see timezones!' },
      });
    }

    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks,
      },
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
          label: { type: 'plain_text', text: 'City (e.g., London)' },
        },
      ],
      private_metadata: body.channel_id || '',
    },
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
      channel_id,
    });

    if (channel_id) {
      await Community.updateOne(
        { channel_id },
        {
          $addToSet: {
            members: { slackId: user_id, name: user.data.name || user_id, city },
          },
        },
        { upsert: true }
      );
    }

    await client.chat.postMessage({
      channel: user_id,
      text: `City set to ${city}! Check the App Home tab to see timezones.`,
    });
  } catch (error) {
    await client.chat.postMessage({
      channel: user_id,
      text: 'Error setting city: ' + (error.response?.data?.error || error.message),
    });
  }
});

// World time API route
app.options('/api/worldtime', cors(corsOptions));
app.get('/api/worldtime', async (req, res) => {
  try {
    const response = await axios.get(`https://api.api-ninjas.com/v1/worldtime?city=${req.query.city}`, {
      headers: { 'X-Api-Key': process.env.API_NINJAS_KEY },
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching world time:', error);
    res.status(500).json({ error: 'An error occurred while fetching world time' });
  }
});

// Fetch user data for dashboard
app.get('/api/user', async (req, res) => {
  try {
    const slackId = req.query.slackId;
    if (!slackId) {
      return res.status(400).json({ error: 'Missing Slack ID' });
    }
    const user = await User.findOne({ slackId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      slackId: user.slackId,
      name: user.name,
      city: user.city || 'Not set',
      teamId: user.teamId,
    });
  } catch (error) {
    console.error('Error fetching user:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start the server only after the database connects
const startServer = async () => {
  await connectToDatabase();
  app.listen(PORT, () => {
    console.log(`server is listening to port ${PORT}`);
  });
};

startServer();

module.exports = app;
module.exports.slackApp = slackApp;