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
} = require('../controllers/authControllers');
const authenticateToken = require('../middleware/authenticateToken');
const slackAuth = require('../middleware/slackAuth');

// Web routes (for debugging and user management)
router.get('/', test);
router.get('/profile', authenticateToken, getProfile);
router.post('/updatename', authenticateToken, updateUserName);
router.post('/addcity', authenticateToken, addCity);
router.get('/cities', authenticateToken, getCity);
router.delete('/deletecity/:city', authenticateToken, deleteCity);
router.get('/channel/:channel_id', authenticateToken, getCommunityByTitle);
router.get('/channel/:channel_id/members', authenticateToken, getMembers);
router.delete('/deletemembers', authenticateToken, deleteAllMembers);

// Slack routes
router.post('/slack/addcity', slackAuth, addCity);
router.get('/slack/channel/:channel_id', slackAuth, getCommunityByTitle);
router.get('/slack/channel/:channel_id/members', slackAuth, getMembers);
router.get('/slack/oauth/callback', slackOAuthCallback);

module.exports = router;