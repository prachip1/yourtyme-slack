const { db } = require('./firebase');
const axios = require('axios');

const test = (req, res) => res.json({ message: 'Test endpoint working' });

const slackOAuthCallback = async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Missing code parameter' });
  }
  try {
    const response = await axios.post('https://slack.com/api/oauth.v2.access', {
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: 'https://yourtyme-slack-backend.vercel.app/slack/oauth/callback',
    });
    if (!response.data.ok) {
      return res.status(400).json({ error: response.data.error });
    }
    const { authed_user } = response.data;
    const slackId = authed_user.id;
    await db.collection('users').doc(slackId).set({ slackId }, { merge: true });
    console.log(`Successfully stored user in database: ${slackId}`);
    res.redirect(`https://yourtyme-slack.vercel.app/dashboard?slackId=${slackId}`);
  } catch (error) {
    console.error('OAuth error:', error.message);
    res.status(500).json({ error: 'OAuth failed' });
  }
};

const addCity = async (req, res) => {
  const { user_id, city, channel_id } = req.body;
  if (!user_id || !city) {
    return res.status(400).json({ error: 'Missing user_id or city' });
  }
  try {
    await db.collection('users').doc(user_id).set({ city }, { merge: true });
    console.log(`Saved city ${city} for user ${user_id}`);
    res.json({ ok: true, message: `City ${city} saved for user ${user_id}` });
  } catch (error) {
    console.error('Add city error:', error.message);
    res.status(500).json({ error: 'Failed to save city' });
  }
};

const getCity = async (req, res) => {
  const slackId = req.user.slackId;
  try {
    const userDoc = await db.collection('users').doc(slackId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { city } = userDoc.data();
    res.json({ city });
  } catch (error) {
    console.error('Get city error:', error.message);
    res.status(500).json({ error: 'Failed to get city' });
  }
};

const deleteCity = async (req, res) => {
  const slackId = req.user.slackId;
  const { city } = req.params;
  try {
    const userDoc = await db.collection('users').doc(slackId).get();
    if (!userDoc.exists || userDoc.data().city !== city) {
      return res.status(404).json({ error: 'City not found for user' });
    }
    await db.collection('users').doc(slackId).update({ city: null });
    res.json({ ok: true, message: `City ${city} deleted` });
  } catch (error) {
    console.error('Delete city error:', error.message);
    res.status(500).json({ error: 'Failed to delete city' });
  }
};

const getCommunityByTitle = async (req, res) => {
  const { channel_id } = req.params;
  try {
    const channelDoc = await db.collection('channels').doc(channel_id).get();
    if (!channelDoc.exists) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    res.json(channelDoc.data());
  } catch (error) {
    console.error('Get community error:', error.message);
    res.status(500).json({ error: 'Failed to get community' });
  }
};

const getMembers = async (req, res) => {
  const { channel_id } = req.params;
  try {
    const membersSnapshot = await db.collection('users').where('channel_id', '==', channel_id).get();
    const members = membersSnapshot.docs.map(doc => doc.data());
    res.json(members);
  } catch (error) {
    console.error('Get members error:', error.message);
    res.status(500).json({ error: 'Failed to get members' });
  }
};

const deleteAllMembers = async (req, res) => {
  try {
    const usersSnapshot = await db.collection('users').get();
    const batch = db.batch();
    usersSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    res.json({ ok: true, message: 'All members deleted' });
  } catch (error) {
    console.error('Delete all members error:', error.message);
    res.status(500).json({ error: 'Failed to delete members' });
  }
};

const getProfile = async (req, res) => {
  const slackId = req.user.slackId;
  try {
    const userDoc = await db.collection('users').doc(slackId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(userDoc.data());
  } catch (error) {
    console.error('Get profile error:', error.message);
    res.status(500).json({ error: 'Failed to get profile' });
  }
};

const updateUserName = async (req, res) => {
  const slackId = req.user.slackId;
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Missing username' });
  }
  try {
    await db.collection('users').doc(slackId).set({ username }, { merge: true });
    res.json({ ok: true, message: `Username updated to ${username}` });
  } catch (error) {
    console.error('Update username error:', error.message);
    res.status(500).json({ error: 'Failed to update username' });
  }
};

module.exports = {
  test,
  slackOAuthCallback,
  addCity,
  getCity,
  deleteCity,
  getCommunityByTitle,
  getMembers,
  deleteAllMembers,
  getProfile,
  updateUserName,
};