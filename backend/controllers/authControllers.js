const User = require('../models/User');
const Community = require('../models/Community');
const axios = require('axios');

// Test endpoint
const test = (req, res) => {
  res.json({ message: 'API is working' });
};

// Get Profile endpoint (for debugging)
const getProfile = async (req, res) => {
  try {
    const user = await User.findOne({ slackId: req.user.slackId });
    res.json(user || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update User Name endpoint
const updateUserName = async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { slackId: req.user.slackId },
      { name: req.body.name },
      { new: true }
    );
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add City endpoint
const addCity = async (req, res) => {
  const { city, user_id, channel_id } = req.body;
  try {
    const user = await User.findOneAndUpdate(
      { slackId: user_id },
      { city },
      { new: true }
    );
    if (channel_id) {
      await Community.updateOne(
        { channel_id },
        {
          $addToSet: {
            members: { slackId: user_id, name: user.name || user_id, city },
          },
        },
        { upsert: true }
      );
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get City endpoint
const getCity = async (req, res) => {
  try {
    const user = await User.findOne({ slackId: req.user.slackId });
    res.json({ city: user.city || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get Community by Channel ID endpoint
const getCommunityByTitle = async (req, res) => {
  const { channel_id } = req.params;
  const { channel_name } = req.body;
  try {
    let community = await Community.findOne({ channel_id });
    if (!community) {
      community = await Community.create({
        channel_id,
        channel_name: channel_name || 'Unknown',
        members: [],
        creator: req.user.slackId,
      });
    }
    res.json(community);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete City endpoint
const deleteCity = async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { slackId: req.user.slackId },
      { city: null },
      { new: true }
    );
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get Members endpoint
const getMembers = async (req, res) => {
  const { channel_id } = req.params;
  try {
    const community = await Community.findOne({ channel_id });
    if (!community) {
      return res.status(404).json({ error: 'Community not found' });
    }
    res.json({ members: community.members });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete All Members endpoint
const deleteAllMembers = async (req, res) => {
  try {
    await Community.updateMany({}, { $set: { members: [] } });
    res.json({ message: 'All members deleted' });
  } catch (error) {
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
    const response = await axios.post('https://slack.com/api/oauth.v2.access', {
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code: req.query.code,
      redirect_uri: 'https://yourtyme-slack-backend.vercel.app/slack/oauth/callback',
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    if (!response.data.ok) {
      if (response.data.error === 'invalid_code') {
        throw new Error('The authorization code is invalid or has expired. Please try again by starting a new OAuth flow.');
      }
      throw new Error(`Slack API error: ${response.data.error}`);
    }
    const { access_token, authed_user, team } = response.data;
    if (!authed_user || !authed_user.id) {
      throw new Error('authed_user is missing or invalid in Slack API response');
    }
    console.log('Saving user to database:', { slackId: authed_user.id, teamId: team.id });
    await User.updateOne(
      { slackId: authed_user.id },
      { slackAccessToken: access_token, slackId: authed_user.id, name: authed_user.id, teamId: team.id },
      { upsert: true }
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