const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const { getDistanceMeters, checkExclusion } = require('./geoUtils');
const { findNearbyFoodPlace } = require('./osmService');
const { sendFoodieNotification } = require('./notifier');
const { sendTelegramFoodiePrompt } = require('./telegramBot');

// In-memory cluster tracking
let currentCluster = null;
let lastKnownLocation = null;

/**
 * Process an incoming location update
 * @param {object} loc 
 * @param {number} loc.lat
 * @param {number} loc.lon
 * @param {number} [loc.acc]
 * @param {number} [loc.tst]
 * @returns {Promise<object>} Status report of the location processing
 */
async function processLocation(loc) {
  const lat = parseFloat(loc.lat);
  const lon = parseFloat(loc.lon);
  const acc = loc.acc ? parseFloat(loc.acc) : 0;
  const timestamp = loc.tst ? (loc.tst > 1e11 ? loc.tst : loc.tst * 1000) : Date.now();

  // Save last known location for manual additions
  if (lat && lon && (!acc || acc <= 65)) {
    lastKnownLocation = { lat, lon, acc, timestamp };
    db.setSetting('last_location', JSON.stringify(lastKnownLocation)).catch(() => {});
  }

  // 1. Ignore poor accuracy fixes (avoids jumping to distant stores)
  if (acc > 45) {
    console.log(`[DwellTracker] Ignored fix with poor accuracy: ${Math.round(acc)}m (must be <= 45m)`);
    return { status: 'skipped', reason: `Low accuracy (${Math.round(acc)}m)` };
  }

  // 2. Check Home & Work exclusion zones
  const exclusion = checkExclusion(lat, lon, config);
  if (exclusion.excluded) {
    // Reset any active cluster since user is home or at work
    currentCluster = null;
    return { status: 'excluded', reason: exclusion.reason };
  }

  const now = timestamp;

  // 3. Evaluate cluster
  if (!currentCluster) {
    currentCluster = {
      centerLat: lat,
      centerLon: lon,
      firstSeenAt: now,
      lastSeenAt: now,
      prompted: false,
      sampleCount: 1
    };
    return { status: 'tracking', durationSeconds: 0, sampleCount: 1 };
  }

  const distFromCenter = getDistanceMeters(lat, lon, currentCluster.centerLat, currentCluster.centerLon);

  if (distFromCenter <= config.STATIONARY_RADIUS_METERS) {
    // Still within stationary cluster
    currentCluster.lastSeenAt = now;
    currentCluster.sampleCount += 1;

    // Moving average center to smooth out GPS jitter
    currentCluster.centerLat = (currentCluster.centerLat * 0.8) + (lat * 0.2);
    currentCluster.centerLon = (currentCluster.centerLon * 0.8) + (lon * 0.2);

    const dwellSeconds = Math.max(0, Math.round((currentCluster.lastSeenAt - currentCluster.firstSeenAt) / 1000));

    console.log(`[DwellTracker] Stationary at (${currentCluster.centerLat.toFixed(4)}, ${currentCluster.centerLon.toFixed(4)}) for ${dwellSeconds}s (threshold: ${config.DWELL_THRESHOLD_SECONDS}s)`);

    // Check if dwell threshold reached and not yet prompted
    if (dwellSeconds >= config.DWELL_THRESHOLD_SECONDS && !currentCluster.prompted) {
      currentCluster.prompted = true; // Mark to prevent duplicate alerts

      // Check 12-hour cooldown for this spot
      const cooldownMs = Date.now() - (config.PROMPT_COOLDOWN_HOURS * 3600 * 1000);
      const recentPrompts = await db.getRecentPrompts(cooldownMs);
      const wasRecentlyPrompted = recentPrompts.some(p => {
        return getDistanceMeters(lat, lon, p.lat, p.lon) <= 100;
      });

      if (wasRecentlyPrompted) {
        console.log(`[DwellTracker] Skipping alert: Venue was already prompted within the last ${config.PROMPT_COOLDOWN_HOURS} hours.`);
        return { status: 'cooldown', dwellSeconds };
      }

      // Identify food stall / restaurant via OpenStreetMap
      console.log(`[DwellTracker] 5+ minutes reached! Querying OpenStreetMap food places...`);
      const place = await findNearbyFoodPlace(lat, lon);

      // Create a pending review session
      const sessionId = 'sess_' + crypto.randomBytes(6).toString('hex');
      await db.insertPending({
        id: sessionId,
        name: place.name,
        candidates: place.candidates,
        lat: lat,
        lon: lon,
        address: place.address,
        category: place.category,
        created_at: Date.now()
      });

      // Record prompt in cooldown table
      await db.recordPrompt(lat, lon, place.name);

      // Send via Telegram Bot (instant 1-tap rating buttons or candidate selection)
      await sendTelegramFoodiePrompt({
        placeName: place.name,
        sessionId: sessionId,
        lat: lat,
        lon: lon,
        category: place.category,
        candidates: place.candidates || []
      });

      // Also send ntfy push notification as backup
      await sendFoodieNotification({
        placeName: place.name,
        sessionId: sessionId,
        lat: lat,
        lon: lon,
        category: place.category
      });

      return {
        status: 'triggered',
        dwellSeconds,
        place,
        sessionId
      };
    }

    return { status: 'dwelling', dwellSeconds, sampleCount: currentCluster.sampleCount };
  } else {
    // User moved away to a new spot
    console.log(`[DwellTracker] Moved ${Math.round(distFromCenter)}m. Resetting stationary cluster.`);
    currentCluster = {
      centerLat: lat,
      centerLon: lon,
      firstSeenAt: now,
      lastSeenAt: now,
      prompted: false,
      sampleCount: 1
    };
    return { status: 'moved', distanceMeters: Math.round(distFromCenter) };
  }
}

function getClusterState() {
  return currentCluster;
}

async function getLastLocation() {
  if (lastKnownLocation) return lastKnownLocation;
  try {
    const raw = await db.getSetting('last_location');
    if (raw) {
      lastKnownLocation = JSON.parse(raw);
      return lastKnownLocation;
    }
  } catch (e) {}
  return null;
}

function resetCluster() {
  currentCluster = null;
}

module.exports = {
  processLocation,
  getClusterState,
  getLastLocation,
  resetCluster
};
