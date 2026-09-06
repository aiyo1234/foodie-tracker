const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

const locationRoutes = require('./routes/location');
const reviewRoutes = require('./routes/reviews');
const mapFeedRoutes = require('./routes/mapFeed');
const { handleTelegramWebhook } = require('./services/telegramBot');

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
app.use('/api', mapFeedRoutes);

// Telegram Webhook
app.post('/api/telegram', async (req, res) => {
  try {
    await handleTelegramWebhook(req.body);
  } catch (err) {
    console.error('[Telegram Webhook Error]:', err);
  }
  res.sendStatus(200);
});

// Test food alert trigger for Telegram
app.get('/api/test-alert', async (req, res) => {
  try {
    const db = require('./db');
    const { sendTelegramFoodiePrompt } = require('./services/telegramBot');
    const sessionId = 'sess_' + Date.now();
    const candidates = [
      { name: 'Sibu Night Market - Ding Bian Hu', distance: 8 },
      { name: 'Ah Huat Kampua Mee & Kompia', distance: 18 },
      { name: 'Central Market Sugar Cane & Fruit Juice', distance: 32 }
    ];
    
    await db.insertPending({
      id: sessionId,
      name: candidates[0].name,
      candidates: candidates,
      lat: 2.30206,
      lon: 111.86868,
      address: 'Market Road, Sibu',
      category: 'Food Stall',
      created_at: Date.now()
    });

    const success = await sendTelegramFoodiePrompt({
      placeName: candidates[0].name,
      sessionId: sessionId,
      lat: 2.30206,
      lon: 111.86868,
      category: 'Food Stall',
      candidates: candidates
    });

    res.json({ success, message: 'Test alert sent with multiple stall options!', sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
