import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';

const Dashboard = () => {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const location = useLocation();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        // Get slackId from URL query parameter
        const params = new URLSearchParams(location.search);
        const slackId = params.get('slackId');
        if (!slackId) {
          throw new Error('Slack ID not provided');
        }
        // Fetch user data from backend
        const response = await axios.get(`https://yourtyme-slack-backend.vercel.app/api/user?slackId=${slackId}`);
        setUser(response.data);
      } catch (err) {
        setError('Failed to load user data. Please try again.');
        console.error(err);
      }
    };
    fetchUser();
  }, [location]);

  if (error) {
    return <div style={{ textAlign: 'center', marginTop: '50px' }}>{error}</div>;
  }

  if (!user) {
    return <div style={{ textAlign: 'center', marginTop: '50px' }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: '600px', margin: '50px auto', textAlign: 'center' }}>
      <h1>Welcome to YourTyme Dashboard</h1>
      <p><strong>Slack ID:</strong> {user.slackId}</p>
      <p><strong>Name:</strong> {user.name}</p>
      <p><strong>City:</strong> {user.city}</p>
      <p><strong>Team ID:</strong> {user.teamId}</p>
      <a
        href={`https://slack.com/app_redirect?app=${process.env.VITE_SLACK_APP_ID}`}
        style={{
          display: 'inline-block',
          marginTop: '20px',
          padding: '10px 20px',
          backgroundColor: '#4A154B',
          color: 'white',
          textDecoration: 'none',
          borderRadius: '5px',
        }}
      >
        Go to YourTyme Slack App
      </a>
    </div>
  );
};

export default Dashboard;