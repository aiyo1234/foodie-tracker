const express = require('express');
const router = express.Router();
const { processLocation, getClusterState, resetCluster } = require('../services/dwellTracker');

/**
 * OwnTracks Webhook Endpoint
 * Receives location updates from OwnTracks iOS App
 */
router.post('/', async (req, res) => {
  try {
    let payload = req.body;

    // OwnTracks can send a single object or an array of objects
    if (Array.isArray(payload)) {
      payload = payload[0];
    }

    if (!payload || !payload.lat || !payload.lon) {
      return res.status(400).json({ error: 'Missing lat or lon in payload' });
    }

    // OwnTracks sends _type: 'location', 'transition', 'lwt', etc.
    if (payload._type && payload._type !== 'location' && payload._type !== 'transition') {
      return res.json({ status: 'ignored_type', type: payload._type });
    }

    const result = await processLocation(payload);

    // OwnTracks iOS HTTP specification strictly requires a JSON array response (e.g. [])
    return res.status(200).json([]);
  } catch (err) {
    console.error('[Route/Location] Error processing location update:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Handle GET/HEAD pings from OwnTracks
 */
router.get('/', (req, res) => {
  res.json([]);
});
router.head('/', (req, res) => {
  res.status(200).end();
});

/**
 * Get current live tracking status
 */
router.get('/status', (req, res) => {
  const cluster = getClusterState();
  res.json({
    activeCluster: cluster,
    timestamp: Date.now()
  });
});

/**
 * Reset tracking cluster (useful for manual testing)
 */
router.post('/reset', (req, res) => {
  resetCluster();
  res.json({ message: 'Tracking cluster reset successfully' });
});

module.exports = router;
