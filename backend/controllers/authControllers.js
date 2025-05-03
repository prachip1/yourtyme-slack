// controllers/authControllers.js
const User = require('../models/User');
const Community = require('../models/Community');

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
            members: { slackId: user_id, name: user.name || user_id, city }
          }
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
        creator: req.user.slackId
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
};