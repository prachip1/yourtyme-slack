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
  let retries = 5;
  while (retries > 0) {
    try {
      await mongoose.connect(process.env.MONGO_URL, {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        retryWrites: true,
        w: 'majority',
      });
      console.log('db connected');
      return; // Exit the loop if successful
    } catch (err) {
      console.error('MongoDB connection failed:', err);
      retries -= 1;
      if (retries === 0) {
        console.error('Max retries reached. Could not connect to MongoDB.');
        process.exit(1);
      }
      console.log(`Retrying connection (${retries} attempts left)...`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
    }
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
// Handle city modal submission
slackApp.view('set_city_modal', async ({ view, ack, client, body }) => {
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

    // Fetch updated data for the modal
    const updatedUser = await User.findOne({ slackId: user_id });
    const channelsResponse = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
    });

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🌍 YourTyme Timezone Tool' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Your City:* ${updatedUser.city} ✅\nYour city has been updated!`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Update City' },
            action_id: 'set_city',
            style: 'primary',
          },
        ],
      },
    ];

    if (channelsResponse.channels && channelsResponse.channels.length > 0) {
      let hasMembers = false;

      for (const channel of channelsResponse.channels) {
        const membersResponse = await client.conversations.members({
          channel: channel.id,
        });

        if (!membersResponse.members || membersResponse.members.length <= 1) continue;

        const membersWithCities = [];
        for (const memberId of membersResponse.members) {
          if (memberId === user_id) continue;
          const member = await User.findOne({ slackId: memberId });
          if (member) {
            const userInfo = await client.users.info({ user: memberId });
            const displayName = userInfo.user?.real_name || userInfo.user?.name || memberId;
            membersWithCities.push({
              slackId: memberId,
              name: displayName,
              city: member.city,
            });
          }
        }

        if (membersWithCities.length === 0) continue;

        hasMembers = true;

        blocks.push(
          {
            type: 'divider',
          },
          {
            type: 'header',
            text: { type: 'plain_text', text: `#${channel.name}` },
          }
        );

        for (const member of membersWithCities) {
          let timeText = `${member.city || 'No city set'}`;
          if (member.city) {
            try {
              const timeResponse = await axios.get(`https://yourtyme-slack-backend.vercel.app/api/worldtime?city=${member.city}`);
              const { datetime, timezone } = timeResponse.data;
              timeText = `${datetime} (${timezone})`;
            } catch (error) {
              timeText = 'Time unavailable (API key missing)';
            }
          }
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${member.name}*: ${timeText}`,
            },
          });
        }
      }

      if (!hasMembers) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'No other members with cities set in your channels. Invite others to set their city! 😊',
          },
        });
      }
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'You’re not in any channels yet. Join a channel to see member timezones! 📢',
        },
      });
    }

    // Update the original modal
    await client.views.update({
      view_id: body.view.root_view_id,
      view: {
        type: 'modal',
        callback_id: 'timezone_view',
        title: { type: 'plain_text', text: 'YourTyme Timezone Tool' },
        close: { type: 'plain_text', text: 'Close' },
        blocks,
      },
    });

    await client.chat.postMessage({
      channel: user_id,
      text: `City set to ${city}! The modal has been updated with your new timezone. 🎉`,
    });
  } catch (error) {
    await client.chat.postMessage({
      channel: user_id,
      text: 'Error setting city: ' + (error.response?.data?.error || error.message),
    });
  }
});

// Handle /yourtyme slash command to open the modal
slackApp.command('/yourtyme', async ({ command, ack, client }) => {
  await ack();

  try {
    const userId = command.user_id;
    let user = null;

    // Attempt to fetch user data, but don't fail if MongoDB is down
    try {
      user = await User.findOne({ slackId: userId });
    } catch (dbError) {
      console.error('MongoDB query failed:', dbError);
      // Continue without user data
    }

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🌍 YourTyme Timezone Tool' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: user?.city
            ? `*Your City:* ${user.city}`
            : '*Your City:* Not set. Set your city to share your timezone with others! 🌟',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: user?.city ? 'Update City' : 'Set City' },
            action_id: 'set_city',
            style: user?.city ? 'primary' : 'danger',
          },
        ],
      },
    ];

    try {
      const channelsResponse = await client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
      });

      if (channelsResponse.channels && channelsResponse.channels.length > 0) {
        let hasMembers = false;

        for (const channel of channelsResponse.channels) {
          const membersResponse = await client.conversations.members({
            channel: channel.id,
          });

          if (!membersResponse.members || membersResponse.members.length <= 1) continue;

          const membersWithCities = [];
          for (const memberId of membersResponse.members) {
            if (memberId === userId) continue;
            try {
              const member = await User.findOne({ slackId: memberId });
              if (member) {
                const userInfo = await client.users.info({ user: memberId });
                const displayName = userInfo.user?.real_name || userInfo.user?.name || memberId;
                membersWithCities.push({
                  slackId: memberId,
                  name: displayName,
                  city: member.city,
                });
              }
            } catch (dbError) {
              console.error(`MongoDB query failed for member ${memberId}:`, dbError);
              // Skip this member if MongoDB fails
            }
          }

          if (membersWithCities.length === 0) continue;

          hasMembers = true;

          blocks.push(
            {
              type: 'divider',
            },
            {
              type: 'header',
              text: { type: 'plain_text', text: `#${channel.name}` },
            }
          );

          for (const member of membersWithCities) {
            let timeText = `${member.city || 'No city set'}`;
            if (member.city) {
              try {
                const timeResponse = await axios.get(`https://yourtyme-slack-backend.vercel.app/api/worldtime?city=${member.city}`);
                const { datetime, timezone } = timeResponse.data;
                timeText = `${datetime} (${timezone})`;
              } catch (error) {
                timeText = 'Time unavailable (API key missing)';
              }
            }
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${member.name}*: ${timeText}`,
              },
            });
          }
        }

        if (!hasMembers) {
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'No other members with cities set in your channels. Invite others to set their city! 😊',
            },
          });
        }
      } else {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'You’re not in any channels yet. Join a channel to see member timezones! 📢',
          },
        });
      }
    } catch (slackError) {
      console.error('Slack API error:', slackError);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '⚠️ Unable to fetch channel data. Please try again later.',
        },
      });
    }

    // Open the modal
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'timezone_view',
        title: { type: 'plain_text', text: 'YourTyme Timezone Tool' },
        close: { type: 'plain_text', text: 'Close' },
        blocks,
      },
    });
  } catch (error) {
    console.error('Error opening modal:', error);
    await client.chat.postMessage({
      channel: command.user_id,
      text: 'Error opening YourTyme modal: ' + error.message,
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