require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ⭐ Serve UI from public folder ⭐
app.use(express.static(path.join(__dirname, 'public')));

// When user opens http://localhost:4000/
// send public/index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API routes
const bookingsRoute = require('./routes/bookings');
app.use('/api/bookings', bookingsRoute);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0' });
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
