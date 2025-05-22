const express = require('express');
const authRoutes = require('./routes/authRoutes');
require('dotenv').config(); // Load .env

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/', authRoutes);

app.get('/', (req, res) => res.json({ message: 'YourTyme Backend Running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));