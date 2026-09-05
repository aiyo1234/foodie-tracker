const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

const locationRoutes = require('./routes/location');
const reviewRoutes = require('./routes/reviews');

const app = express();

// Enable Cross-Origin requests
app.use(cors());

// Parse JSON and form bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded food photos
app.use('/uploads', express.static(config.UPLOADS_DIR));

// Serve frontend static web application
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/location', locationRoutes);
app.use('/api/reviews', reviewRoutes);

// Health check endpoint (for Render / Uptime monitors to prevent cold starts)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// App configuration info endpoint (public client settings)
app.get('/api/config', (req, res) => {
  res.json({
    topic: config.NTFY_TOPIC,
    dwellThresholdSeconds: config.DWELL_THRESHOLD_SECONDS,
    hasHomeGeofence: !!(config.HOME_LAT && config.HOME_LON),
    hasWorkGeofence: !!(config.WORK_LAT && config.WORK_LON)
  });
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start Server
app.listen(config.PORT, () => {
  console.log(`====================================================`);
  console.log(`🍽️  Foodie Tracker Server is running!`);
  console.log(`🌐 Local Web Dashboard:  http://localhost:${config.PORT}`);
  console.log(`📍 OwnTracks Webhook:    http://localhost:${config.PORT}/api/location`);
  console.log(`🔔 ntfy Alert Topic:    ${config.NTFY_TOPIC}`);
  console.log(`====================================================`);
});
