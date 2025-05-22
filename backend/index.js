const { App } = require('@slack/bolt');
const admin = require('firebase-admin');
const axios = require('axios');
require('dotenv').config(); // Load .env

// Initialize Firebase
let db;
try {
  if (!process.env.FIREBASE_CREDENTIALS) {
    throw new Error('FIREBASE_CREDENTIALS is not set in environment');
  }
  const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  db = admin.firestore();
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Firebase initialization failed:', error.message);
  process.exit(1); // Exit if Firebase fails
}

// Initialize Slack App
const slackApp = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN,
});

// /yourtyme Command
slackApp.command('/yourtyme', async ({ command, ack, respond }) => {
  await ack();
  try {
    const city = command.text.trim();
    if (!city) {
      await respond('Please provide a city, e.g., `/yourtyme London`');
      return;
    }
    await db.collection('users').doc(command.user_id).set({
      slackId: command.user_id,
      city,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`Saved city ${city} for user ${command.user_id}`);
    await respond(`City set to ${city}! Check the YourTyme app Home tab.`);
  } catch (error) {
    console.error('Error saving city:', error);
    await respond('Error saving city. Please try again.');
  }
});

// app_home_opened Event
slackApp.event('app_home_opened', async ({ event, client }) => {
  const startTime = Date.now();
  console.log('Received app_home_opened event for user:', event.user);
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

    // Fetch channels
    let channelsResponse;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        channelsResponse = await client.conversations.list({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 100,
        });
        console.log('Fetched channels:', channelsResponse.channels?.map(c => ({ id: c.id, name: c.name })) || []);
        break;
      } catch (error) {
        console.error(`Error fetching channels (attempt ${attempt}):`, error);
        if (attempt === 5) channelsResponse = { channels: [] };
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }

    let hasMembers = false;
    const allMembers = new Set();

    if (channelsResponse.channels && channelsResponse.channels.length > 0) {
      for (const channel of channelsResponse.channels) {
        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            const membersResponse = await client.conversations.members({
              channel: channel.id,
              limit: 100,
            });
            console.log(`Members in channel ${channel.id} (${channel.name}):`, membersResponse.members);
            if (membersResponse.members) {
              membersResponse.members.forEach(memberId => allMembers.add(memberId));
            }
            break;
          } catch (error) {
            console.error(`Error fetching members for channel ${channel.id} (attempt ${attempt}):`, error);
            if (attempt === 5) break;
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          }
        }
      }

      console.log('All unique members:', Array.from(allMembers));

      if (allMembers.size > 0) {
        hasMembers = true;
        blocks.push({
          type: 'header',
          text: { type: 'plain_text', text: 'Team Members' },
        });

        for (const memberId of allMembers) {
          if (Date.now() - startTime > 25000) {
            console.warn('Approaching Vercel timeout, stopping member processing');
            blocks.push({
              type: 'section',
              text: { type: 'mrkdwn', text: '⚠️ Partial data loaded due to timeout.' },
            });
            break;
          }

          if (memberId === 'U08SE79SR52') {
            console.log(`Skipping removed user ${memberId}`);
            continue;
          }

          try {
            let userInfo;
            for (let attempt = 1; attempt <= 5; attempt++) {
              try {
                userInfo = await client.users.info({ user: memberId });
                if (!userInfo.ok || !userInfo.user || userInfo.user.deleted) {
                  console.log(`Skipping deleted/invalid user ${memberId}`);
                  continue;
                }
                console.log(`Fetched user info for ${memberId}:`, {
                  slackId: userInfo.user.id,
                  displayName: userInfo.user.real_name || userInfo.user.name,
                });
                break;
              } catch (error) {
                console.error(`Error fetching user info for ${memberId} (attempt ${attempt}):`, error);
                if (attempt === 5) {
                  console.log(`Skipping member ${memberId} due to repeated errors`);
                  continue;
                }
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
              }
            }
            if (!userInfo || !userInfo.user) continue;

            const displayName = userInfo.user.real_name || userInfo.user.name || memberId;

            let city = 'Not set';
            try {
              const userDoc = await db.collection('users').doc(memberId).get();
              if (userDoc.exists) {
                city = userDoc.data().city || 'Not set';
                console.log(`Firestore data for ${memberId}:`, {
                  slackId: memberId,
                  city,
                });
              }
            } catch (dbError) {
              console.error(`Firestore query failed for ${memberId}:`, dbError);
              city = 'Database unavailable';
            }

            let timeText = city;
            if (city !== 'Not set' && city !== 'Database unavailable') {
              for (let attempt = 1; attempt <= 3; attempt++) {
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
                  break;
                } catch (timeError) {
                  console.error(`Error fetching time for ${city} (attempt ${attempt}):`, timeError);
                  if (attempt === 3) timeText = `${city}, Time unavailable`;
                }
              }
            }

            blocks.push(
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*${displayName}*\n*City:* ${city}\n*Time:* ${timeText}`,
                },
              },
              { type: 'divider' }
            );
          } catch (error) {
            console.error(`Error processing member ${memberId}:`, error);
            blocks.push(
              {
                type: 'section',
                text: { type: 'mrkdwn', text: `*${memberId}*: Error fetching data` },
              },
              { type: 'divider' }
            );
          }
        }
      }
    }

    if (!hasMembers) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: 'No team members found in your channels. Use `/yourtyme` to set your city and invite others! 😊' },
      });
    }

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await client.views.publish({
          user_id: event.user,
          view: { type: 'home', blocks },
        });
        console.log(`Published Home tab for user ${event.user} in ${Date.now() - startTime}ms`);
        break;
      } catch (error) {
        console.error(`Error publishing Home tab (attempt ${attempt}):`, error);
        if (attempt === 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  } catch (error) {
    console.error('App Home error:', error);
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
              text: { type: 'mrkdwn', text: 'Error loading team timezones. Please try again later or contact support. ⚠️' },
            },
          ],
        },
      });
    } catch (publishError) {
      console.error('Failed to publish fallback view:', publishError);
    }
  }
});

// Start Slack App
(async () => {
  try {
    await slackApp.start(process.env.PORT || 3000);
    console.log('⚡️ YourTyme app is running!');
  } catch (error) {
    console.error('Failed to start Slack app:', error);
    process.exit(1);
  }
})();