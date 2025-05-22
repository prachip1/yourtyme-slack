const admin = require('firebase-admin');
require('dotenv').config();

let db;
try {
  if (!process.env.FIREBASE_CREDENTIALS) {
    throw new Error('FIREBASE_CREDENTIALS is not set in environment');
  }
  console.log('FIREBASE_CREDENTIALS length:', process.env.FIREBASE_CREDENTIALS.length);
  console.log('FIREBASE_CREDENTIALS start:', process.env.FIREBASE_CREDENTIALS.substring(0, 50));
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
  } catch (jsonError) {
    throw new Error(`Invalid JSON in FIREBASE_CREDENTIALS: ${jsonError.message}`);
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  db = admin.firestore();
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Firebase initialization failed:', error.message);
  throw error;
}

module.exports = { db, admin };