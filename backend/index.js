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
        serverSelectionTimeoutMS: 60000,
        connectTimeoutMS: 60000,
        socketTimeoutMS: 90000,
        retryWrites: true,
        w: 'majority',
      });
      await new Promise((resolve, reject) => {
        const checkState = setInterval(() => {
          if (mongoose.connection.readyState === 1) {
            clearInterval(checkState);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkState);
          reject(new Error('MongoDB connection not ready after 30s'));
        }, 30000);
      });
      console.log('db connected, state:', mongoose.connection.readyState);
      return;
    } catch (err) {
      console.error('MongoDB connection failed:', err);
      retries -= 1;
      if (retries === 0) {
        console.error('Max retries reached. Could not connect to MongoDB.');
        throw err; // Let caller handle
      }
      console.log(`Retrying connection (${retries} attempts left)...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
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
  const startTime = Date.now();
  console.log('Received app_home_opened event for user:', event.user);
  console.log('MongoDB connection state:', mongoose.connection.readyState);
  try {
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🌍 YourTyme Timezone Tool' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'Timezone information for your team members across your channels.' },
      },
      {
        type: 'divider',
      },
    ];

    // Fetch user's channels
    let channelsResponse;
    try {
      channelsResponse = await client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 100,
      });
      console.log('Fetched channels:', channelsResponse.channels?.map(c => ({ id: c.id, name: c.name })) || []);
    } catch (error) {
      console.error('Error fetching channels:', error);
      channelsResponse = { channels: [] };
    }

    let hasMembers = false;
    const allMembers = new Set();

    if (channelsResponse.channels && channelsResponse.channels.length > 0) {
      // Collect unique members across all channels
      for (const channel of channelsResponse.channels) {
        try {
          const membersResponse = await client.conversations.members({
            channel: channel.id,
            limit: 100,
          });
          console.log(`Members in channel ${channel.id} (${channel.name}):`, membersResponse.members);
          if (membersResponse.members) {
            membersResponse.members.forEach(memberId => allMembers.add(memberId));
          }
        } catch (error) {
          console.error(`Error fetching members for channel ${channel.id}:`, error);
        }
      }

      // Include all members
      console.log('All unique members:', Array.from(allMembers));

      if (allMembers.size > 0) {
        hasMembers = true;
        blocks.push({
          type: 'header',
          text: { type: 'plain_text', text: 'Team Members' },
        });

        // In-memory cache for user data (fallback for MongoDB failures)
        const userCache = new Map();

        // Fetch member details in parallel
        const memberPromises = Array.from(allMembers).map(async (memberId) => {
          try {
            // Get Slack user info
            const userInfo = await client.users.info({ user: memberId });
            const displayName = userInfo.user?.real_name || userInfo.user?.name || memberId;
            console.log(`Fetched user info for ${memberId}:`, { slackId: userInfo.user?.id, displayName });

            // Get city from cache or MongoDB
            let user = userCache.get(memberId);
            if (!user) {
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  user = await User.findOne({ slackId: memberId });
                  userCache.set(memberId, user);
                  break;
                } catch (dbError) {
                  console.error(`MongoDB query attempt ${attempt} failed for ${memberId}:`, dbError);
                  if (attempt === 3) user = null;
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
            }
            const city = user?.city || 'Not set';
            console.log(`MongoDB/cache data for ${memberId}:`, { slackId: user?.slackId, city });

            // Fetch current time if city is set
            let timeText = city;
            if (city !== 'Not set') {
              try {
                const timeResponse = await axios.get(
                  `https://api.api-ninjas.com/v1/worldtime?city=${encodeURIComponent(city)}`,
                  {
                    headers: { 'X-Api-Key': process.env.API_NINJAS_KEY },
                  }
                );
                const { datetime, timezone } = timeResponse.data;
                timeText = `${datetime} (${timezone})`;
                console.log(`Time fetched for ${city}:`, { datetime, timezone });
              } catch (timeError) {
                console.error(`Error fetching time for ${city}:`, timeError);
                timeText = `${city}, Time unavailable`;
              }
            }

            return {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${displayName}*\n*City:* ${city}\n*Time:* ${timeText}`,
              },
            };
          } catch (error) {
            console.error(`Error processing member ${memberId}:`, error);
            return {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${memberId}*: Error fetching data`,
              },
            };
          }
        });

        // Wait for all member data and add to blocks
        const memberBlocks = await Promise.all(memberPromises);
        blocks.push(...memberBlocks.map(block => [block, { type: 'divider' }]).flat());
      }
    }

    // Add message if no members or channels
    if (!hasMembers) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'No team members found in your channels. Use `/yourtyme` to set your city and invite others! 😊',
        },
      });
    }

    // Publish Home tab view
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks,
      },
    });
    console.log(`Published Home tab for user ${event.user} in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('App Home error:', error);
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
            text: {
              type: 'mrkdwn',
              text: 'Error loading team timezones. Please try again later or contact support. ⚠️',
            },
          },
        ],
      },
    });
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

  let updatedUser = null;
  let userUpdateSuccess = false;

  // Attempt to update the user's city
  try {
    const user = await axios.post('https://yourtyme-slack-backend.vercel.app/slack/addcity', {
      user_id,
      city,
      channel_id,
    });
    userUpdateSuccess = true;
    updatedUser = await User.findOne({ slackId: user_id });
  } catch (error) {
    console.error('Error updating user city:', error);
    updatedUser = { city: 'Not set (update failed)' };
  }

  // Attempt to update the community (if channel_id exists)
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
    } catch (error) {
      console.error('Error updating community:', error);
    }
  }

  // Fetch updated data for the modal
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

  // Send a confirmation message (since messaging is now enabled)
  if (userUpdateSuccess) {
    await client.chat.postMessage({
      channel: user_id,
      text: `City set to ${city}! The modal has been updated with your new timezone. 🎉`,
    });
  } else {
    await client.chat.postMessage({
      channel: user_id,
      text: 'Failed to update your city due to database issues. Please try again later. ⚠️',
    });
  }
});

// Handle /yourtyme slash command to open the modal
slackApp.command('/yourtyme', async ({ command, ack, client }) => {
  console.log('Received /yourtyme command:', command);
  const startTime = Date.now();
  try {
    await ack();
    console.log(`Acknowledged /yourtyme command in ${Date.now() - startTime}ms`);

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
              type: 'plain_text_input',
              action_id: 'city_input',
              placeholder: { type: 'plain_text', text: 'Enter a city (e.g., Hyderabad)' },
            },
            label: { type: 'plain_text', text: 'City' },
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
  const selectedCity = values.city_block.city_input.value?.trim() || 'Unknown';
  const selectedMembers = values.members_block.members_select.selected_users || [];
  const userId = body.user.id;

  console.log('Selected city:', selectedCity);
  console.log('Selected members:', selectedMembers);
  console.log('Submitting user:', userId);

  try {
    // Validate city and fetch timezone data
    let timezoneData = { city: selectedCity, datetime: 'Time unavailable', timezone: 'Unknown' };
    let cityValid = false;
    try {
      const response = await axios.get(`https://api.api-ninjas.com/v1/worldtime?city=${encodeURIComponent(selectedCity)}`, {
        headers: { 'X-Api-Key': process.env.API_NINJAS_KEY },
      });
      timezoneData = response.data;
      cityValid = true;
      console.log('Timezone data fetched:', timezoneData);
    } catch (apiError) {
      console.error('Error fetching timezone data:', apiError);
      timezoneData.datetime = apiError.response?.status === 400 ? 'Invalid city name' : 'Time unavailable';
    }

    // Save user's city to MongoDB if valid
    if (cityValid) {
      try {
        await User.findOneAndUpdate(
          { slackId: userId },
          { $set: { city: selectedCity } },
          { upsert: true, new: true }
        );
        console.log(`Saved city ${selectedCity} for user ${userId}`);
      } catch (dbError) {
        console.error('Error saving user city:', dbError);
      }
    }

    // Build member info with times
    const memberBlocks = [];
    for (const memberId of selectedMembers) {
      try {
        const userInfo = await client.users.info({ user: memberId });
        const displayName = userInfo.user?.real_name || userInfo.user?.name || memberId;
        const user = await User.findOne({ slackId: memberId });
        let memberText = `*${displayName}*: ${user?.city || 'Not set'}`;
        if (user?.city) {
          try {
            const timeResponse = await axios.get(`https://api.api-ninjas.com/v1/worldtime?city=${encodeURIComponent(user.city)}`, {
              headers: { 'X-Api-Key': process.env.API_NINJAS_KEY },
            });
            const { datetime, timezone } = timeResponse.data;
            memberText += `, ${datetime} (${timezone})`;
          } catch (timeError) {
            console.error(`Error fetching time for ${user.city}:`, timeError);
            memberText += ', Time unavailable';
          }
        }
        memberBlocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: memberText },
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
    console.log('Pushing results modal with trigger_id:', body.trigger_id);
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

    // Send confirmation DM
    await client.chat.postMessage({
      channel: userId,
      text: cityValid
        ? `City set to ${selectedCity}! Timezone data displayed in the modal.`
        : `Invalid city "${selectedCity}". Please try another city (e.g., Hyderabad, London).`,
    });
  } catch (error) {
    console.error('Error opening results modal:', error);
    await client.chat.postMessage({
      channel: userId,
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