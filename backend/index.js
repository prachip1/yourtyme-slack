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
      return;
    } catch (err) {
      console.error('MongoDB connection failed:', err);
      retries -= 1;
      if (retries === 0) {
        console.error('Max retries reached. Could not connect to MongoDB.');
        process.exit(1);
      }
      console.log(`Retrying connection (${retries} attempts left)...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Middleware setup
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

// CORS setup
const corsOptions = {
  origin: ['http://localhost:517, 'https://yourtyme-slack.vercel.app'],
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
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '🌍 YourTyme Timezone Tool' },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: 'Use the `/yourtyme` command to view and manage team timezones!' },
          },
        ],
      },
    });
    console.log('App Home published for user:', event.user);
  } catch (error) {
    console.error('App Home error:', error);
  }
});

// Handle set city button
slackApp.action('set_city', async ({ body, ack, client }) => {
  console.log('Received set_city action:', body);
  await ack();
  try {
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
    console.log('Set city modal opened for trigger_id:', body.trigger_id);
  } catch (error) {
    console.error('Error opening set city modal:', error);
  }
});

// Handle city modal submission
slackApp.view('set_city_modal', async ({ view, ack, client, body }) => {
  console.log('Received set_city_modal submission:', view);
  await ack();
  const city = view.state.values.city.user_city.value;
  const user_id = body.user.id;
  const channel_id = view.private_metadata;

  let updatedUser = null;
  let userUpdateSuccess = false;

  // Update user's city
  try {
    const userResponse = await axios.post('https://yourtyme-slack-backend.vercel.app/slack/addcity', {
      user_id,
      city,
      channel_id,
    });
    userUpdateSuccess = true;
    updatedUser = await User.findOne({ slackId: user_id });
    console.log('User city updated:', updatedUser);
  } catch (error) {
    console.error('Error updating user city:', error);
    updatedUser = { city: 'Not set (update failed)' };
  }

  // Update community
  if (channel_id && userUpdateSuccess) {
    try {
      await Community.updateOne(
        { channel_id },
        {
          $addToSet: {
            members: { slackId: user_id, name: updatedUser?.name || user_id, city },
          },
        },
        { upsert: true }
      );
      console.log('Community updated for channel:', channel_id);
    } catch (error) {
      console.error('Error updating community:', error);
    }
  }

  // Fetch channel and member data
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🌍 YourTyme Timezone Tool' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: userUpdateSuccess
          ? `*Your City:* ${updatedUser.city} ✅\nYour city has been updated to ${city}! 🎉`
          : `*Your City:* Failed to update city due to database issues. Please try again later. ⚠️`,
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
          if (memberId === user_id) continue;
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
          }
        }

        if (membersWithCities.length === 0) continue;

        hasMembers = true;

        blocks.push(
          { type: 'divider' },
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

  // Update the original modal
  try {
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
    console.log('Timezone view updated for view_id:', body.view.root_view_id);
  } catch (error) {
    console.error('Error updating timezone view:', error);
  }

  // Send confirmation message
  try {
    await client.chat.postMessage({
      channel: user_id,
      text: userUpdateSuccess
        ? `City set to ${city}! The modal has been updated with your new timezone. 🎉`
        : 'Failed to update your city due to database issues. Please try again later. ⚠️',
    });
    console.log('Confirmation message sent to user:', user_id);
  } catch (error) {
    console.error('Error sending confirmation message:', error);
  }
});

// Handle /yourtyme slash command to open the modal
slackApp.command('/yourtyme', async ({ command, ack, client }) => {
  console.log('Received /yourtyme command:', command);
  try {
    await ack();
    console.log('Acknowledged /yourtyme command');

    if (!command.trigger_id) {
      console.error('No trigger_id provided in command');
      await client.chat.postMessage({
        channel: command.user_id,
        text: 'Error: Unable to open modal due to missing trigger_id.',
      });
      return;
    }

    console.log('Attempting to open initial modal');
    const initialView = await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'timezone_view',
        title: { type: 'plain_text', text: 'YourTyme Timezone Tool' },
        submit: { type: 'plain_text', text: 'Submit' },
        close: { type: 'plain_text', text: 'Close' },
        blocks: [
          {
            type: 'input',
            block_id: 'city_block',
            element: {
              type: 'static_select',
              action_id: 'city_select',
              options: [
                { text: { type: 'plain_text', text: 'New York' }, value: 'America/New_York' },
                { text: { type: 'plain_text', text: 'London' }, value: 'Europe/London' },
                { text: { type: 'plain_text', text: 'Tokyo' }, value: 'Asia/Tokyo' },
                { text: { type: 'plain_text', text: 'Sydney' }, value: 'Australia/Sydney' },
              ],
            },
            label: { type: 'plain_text', text: 'Select a city' },
          },
          {
            type: 'input',
            block_id: 'members_block',
            element: {
              type: 'multi_users_select',
              action_id: 'members_select',
              placeholder: { type: 'plain_text', text: 'Select team members' },
            },
            label: { type: 'plain_text', text: 'Select team members' },
          },
        ],
      },
    });
    console.log('Initial modal opened successfully:', initialView);
  } catch (error) {
    console.error('Error opening initial modal:', error);
    await client.chat.postMessage({
      channel: command.user_id,
      text: 'Error in /yourtyme command: ' + error.message,
    });
  }
});

// Handle timezone_view submission
slackApp.view('timezone_view', async ({ view, ack, client, body }) => {
  console.log('Received timezone_view submission:', view);
  await ack();

  const values = view.state.values;
  const selectedCity = values.city_block.city_select.selected_option?.value || 'Unknown';
  const selectedMembers = values.members_block.members_select.selected_users || [];

  console.log('Selected city:', selectedCity);
  console.log('Selected members:', selectedMembers);

  try {
    // Fetch timezone data
    let timezoneData = { city: selectedCity, datetime: 'Time unavailable', timezone: selectedCity };
    try {
      const cityName = selectedCity.split('/')[1] || selectedCity;
      const response = await axios.get(`https://api.api-ninjas.com/v1/worldtime?city=${cityName}`, {
        headers: { 'X-Api-Key': process.env.API_NINJAS_KEY },
      });
      timezoneData = response.data;
      console.log('Timezone data fetched:', timezoneData);
    } catch (apiError) {
      console.error('Error fetching timezone data:', apiError);
    }

    // Build member info
    const memberBlocks = [];
    for (const memberId of selectedMembers) {
      try {
        const userInfo = await client.users.info({ user: memberId });
        const displayName = userInfo.user?.real_name || userInfo.user?.name || memberId;
        const user = await User.findOne({ slackId: memberId });
        const memberCity = user?.city || 'Not set';
        memberBlocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*${displayName}*: ${memberCity}` },
        });
      } catch (error) {
        console.error(`Error fetching info for member ${memberId}:`, error);
        memberBlocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*${memberId}*: Error fetching data` },
        });
      }
    }

    // Push results modal
    const resultView = await client.views.push({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'timezone_results_view',
        title: { type: 'plain_text', text: 'Timezone Results' },
        close: { type: 'plain_text', text: 'Close' },
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '🌍 Timezone Results' },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*City:* ${timezoneData.city}\n*Time:* ${timezoneData.datetime} (${timezoneData.timezone})`,
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'header',
            text: { type: 'plain_text', text: 'Selected Members' },
          },
          ...(memberBlocks.length > 0 ? memberBlocks : [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: 'No members selected.' },
            },
          ]),
        ],
      },
    });
    console.log('Results modal opened successfully:', resultView);
  } catch (error) {
    console.error('Error opening results modal:', error);
    await client.chat.postMessage({
      channel: body.user.id,
      text: 'Error displaying timezone results: ' + error.message,
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

// Start the server
const startServer = async () => {
  await connectToDatabase();
  app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
  });
};

startServer();

module.exports = app;
module.exports.slackApp = slackApp;