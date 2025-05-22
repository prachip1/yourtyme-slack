const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function importUsers() {
  const users = [
    {
      slackId: 'U08Q1P3JDJB',
      city: 'London',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  for (const user of users) {
    await db.collection('users').doc(user.slackId).set({
      slackId: user.slackId,
      city: user.city,
      createdAt: admin.firestore.Timestamp.fromDate(user.createdAt),
      updatedAt: admin.firestore.Timestamp.fromDate(user.updatedAt),
    });
    console.log(`Imported user ${user.slackId}`);
  }
}

importUsers().catch(console.error);