const axios = require('axios');
const { db, admin } = require('./firebase');

// Test endpoint
const test = (req, res) => {
  res.json({ message: 'API is working' });
};

// Get Profile endpoint
const getProfile = async (req, res) => {
  try {
    const slackId = req.user.slackId;
    console.log(`Fetching profile for slackId: ${slackId}`);
    const userDoc = await db.collection('users').doc(slackId).get();
    res.json(userDoc.exists ? userDoc.data() : null);
  } catch (error) {
    console.error(`Error in getProfile for slackId ${req.user.slackId}:`, error);
    res.status(500).json({ error: error.message });
  }
};

// Update User Name endpoint
const updateUserName = async (req, res) => {
  try {
    const slackId = req.user.slackId;
    const name = req.body.name;
    console.log(`Updating name for slackId: ${slackId}, name: ${name}`);
    await db.collection('users').doc(slackId).set(
      { name, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    const userDoc = await db.collection('users').doc(slackId).get();
    res.json(userDoc.exists ? userDoc.data() : null);
  } catch (error) {
    console.error(`Error in updateUserName for slackId ${slackId}:`, error);
    res.status(500).json({ error: error.message });
  }
};

// Add City endpoint
const addCity = async (req, res) => {
  const { city, user_id, channel_id } = req.body;
  try {
    console.log(`Adding city for slackId: ${user_id}, city: ${city}, channel_id: ${channel_id}`);
    await db.collection('users').doc(user_id).set(
      {
        slackId: user_id,
        city,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    const userDoc = await db.collection('users').doc(user_id).get();
    if (!userDoc.exists) {
      throw new Error(`User not found for slackId: ${user_id}`);
    }
    const user = userDoc.data();
    if (channel_id) {
      await db.collection('communities').doc(channel_id).set(
        {
          members: admin.firestore.FieldValue.arrayUnion({
            slackId: user_id,
            name: user.name || user_id,
            city,
          }),
        },
        { merge: true }
      );
    }
    res.json(user);
  } catch (error) {
    console.error(`Error in addCity for slackId ${user_id}:`, error);
    res.status(500).json({ error: error.message });
  }
};

// Get City endpoint
const getCity = async (req, res) => {
  try {
    const slackId = req.user.slackId;
    console.log(`Fetching city for slackId: ${slackId}`);
    const userDoc = await db.collection('users').doc(slackId).get();
    res.json({ city: userDoc.exists ? userDoc.data().city || null : null });
  } catch (error) {
    console.error(`Error in getCity for slackId ${slackId}:`, error);
    res.status(500).json({ error: error.message });
  }
};

// Get Community by Channel ID endpoint
const getCommunityByTitle = async (req, res) => {
  const { channel_id } = req.params;
  const { channel_name } = req.body;
  try {
    console.log(`Fetching community for channel_id: ${channel_id}`);
    const communityDoc = await db.collection('communities').doc(channel_id).get();
    let community;
    if (!communityDoc.exists) {
      community = {
        channel_id,
        channel_name: channel_name || 'Unknown',
        members: [],
        creator: req.user.slackId,
      };
      await db.collection('communities').doc(channel_id).set(community);
    } else {
      community = communityDoc.data();
    }
    res.json(community);
  } catch (error) {
    console.error(`Error in getCommunityByTitle for channel_id ${channel_id}:`, error);
    res.status(500).json({ error: error.message });
  }
};

// Delete City endpoint
const deleteCity = async (req, res) => {
  try {
    const slackId = req.user.slackId;
    console.log(`Deleting city for slackId: ${slackId}`);
    await db.collection('users').doc(slackId).set(
      { city: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    const userDoc = await db.collection('users').doc(slackId).get();
    res.json(userDoc.exists ? userDoc.data() : null);
  } catch (error) {
    console.error(`Error in deleteCity for slackId ${slackId}:`, error);
    res.status(500).json({ error: error.message });
  }
};

// Get Members endpoint
const getMembers = async (req, res) => {
  const { channel_id } = req.params;
  try {
    console.log(`Fetching members for channel_id: ${channel_id}`);
    const communityDoc = await db.collection('communities').doc(channel_id).get();
    if (!communityDoc.exists) {
      return res.status(404).json({ error: 'Community not found' });
    }
    res.json({ members: communityDoc.data().members || [] });
  } catch (error) {
    console.error(`Error in getMembers for channel_id ${channel_id}:`, error);
    res.status(500).json({ error: error.message });
  }
};

// Delete All Members endpoint
const deleteAllMembers = async (req, res) => {
  try {
    console.log('Deleting all community members');
    const batch = db.batch();
    const communities = await db.collection('communities').get();
    communities.forEach(doc => {
      batch.update(doc.ref, { members: [] });
    });
    await batch.commit();
    res.json({ message: 'All members deleted' });
  } catch (error) {
    console.error('Error in deleteAllMembers:', error);
    res.status(500).json({ error: error.message });
  }
};

// Slack OAuth Callback
const slackOAuthCallback = async (req, res) => {
  try {
    if (!req.query.code) {
      throw new Error('Missing code parameter in callback');
    }
    console.log('Received OAuth callback with code:', req.query.code);
    console.log('Using client_id:', process.env.SLACK_CLIENT_ID);
    console.log('Using redirect_uri:', 'https://yourtyme-slack-backend.vercel.app/slack/oauth/callback');
    const response = await axios.post(
      'https://slack.com/api/oauth.v2.access',
      {
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code: req.query.code,
        redirect_uri: 'https://yourtyme-slack-backend.vercel.app/slack/oauth/callback',
      },
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    if (!response.data.ok) {
      if (response.data.error === 'invalid_code') {
        throw new Error('The authorization code is invalid or has expired. Please try again.');
      }
      throw new Error(`Slack API error: ${response.data.error}`);
    }
    const { access_token, authed_user, team } = response.data;
    if (!authed_user || !authed_user.id) {
      throw new Error('authed_user is missing or invalid in Slack API response');
    }
    // Fetch user info for real name
    const userInfoResponse = await axios.get('https://slack.com/api/users.info', {
      headers: { Authorization: `Bearer ${access_token}` },
      params: { user: authed_user.id },
    });
    if (!userInfoResponse.data.ok) {
      throw new Error(`Failed to fetch user info: ${userInfoResponse.data.error}`);
    }
    const realName = userInfoResponse.data.user?.real_name || userInfoResponse.data.user?.name || authed_user.id;
    console.log('Saving user to database:', { slackId: authed_user.id, teamId: team.id, name: realName });
    await db.collection('users').doc(authed_user.id).set(
      {
        slackAccessToken: access_token,
        slackId: authed_user.id,
        name: realName,
        teamId: team.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log('Successfully stored user in database:', authed_user.id);
    res.redirect(`https://yourtyme-slack.vercel.app/dashboard?slackId=${authed_user.id}`);
  } catch (error) {
    console.error('OAuth error:', error.message);
    if (error.response) {
      console.error('Slack API response:', error.response.data);
    }
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
};

module.exports = {
  test,
  getProfile,
  updateUserName,
  addCity,
  getCity,
  getCommunityByTitle,
  deleteCity,
  getMembers,
  deleteAllMembers,
  slackOAuthCallback,
};