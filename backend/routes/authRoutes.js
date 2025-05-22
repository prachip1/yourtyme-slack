const express = require('express');
const router = express.Router();
const {
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
} = require('../authControllers'); // Fixed import
const authenticateToken = require('../middleware/authenticateToken');
const slackAuth = require('../middleware/slackAuth');

// Web routes (for debugging and user management)
router.get('/', test);
router.get('/slack/profile', authenticateToken, getProfile);
router.post('/slack/update', authenticateToken, updateUserName);
router.post('/slack/addcity', authenticateToken, addCity);
router.get('/slack/getcity', authenticateToken, getCity);
router.delete('/slack/deletecity', authenticateToken, deleteCity);
router.get('/slack/community/:channel_id', authenticateToken, getCommunityByTitle);
router.get('/slack/community/members/:channel_id', authenticateToken, getMembers);
router.delete('/slack/deletemembers', authenticateToken, deleteAllMembers);

// Slack routes (for Slack API interactions)
router.post('/slack/addcity', slackAuth, addCity);
router.get('/slack/community/:channel_id', slackAuth, getCommunityByTitle);
router.get('/slack/community/members/:channel_id', slackAuth, getMembers);
router.get('/slack/oauth/callback', slackOAuthCallback);

module.exports = router;