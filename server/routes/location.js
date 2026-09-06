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
    if (!payload) {
      return res.status(200).json([]);
    }

    // Process batched array payloads in chronological order
    const items = Array.isArray(payload) ? payload : [payload];
    items.sort((a, b) => (a.tst || 0) - (b.tst || 0));

    for (const item of items) {
      if (item._type && item._type !== 'location' && item._type !== 'transition') {
        continue;
      }
      if (item.lat == null || item.lon == null) {
        continue;
      }
      await processLocation(item);
    }

    // OwnTracks iOS HTTP specification strictly requires a JSON array response (e.g. [])
    return res.status(200).json([]);
  } catch (err) {
    console.error('[Route/Location] Error processing location update:', err);
    return res.status(200).json([]);
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
