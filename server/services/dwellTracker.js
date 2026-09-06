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
let clusterLoadedFromDb = false;

// Load persisted cluster on boot to survive Render free-tier cold starts
async function loadClusterState() {
  if (clusterLoadedFromDb) return;
  clusterLoadedFromDb = true;
  try {
    const saved = await db.getSetting('active_cluster');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Only restore if cluster was active within the last 30 minutes
      if (Date.now() - parsed.lastSeenAt < 30 * 60 * 1000) {
        currentCluster = parsed;
        console.log(`[DwellTracker] Restored active cluster from DB: (${parsed.anchorLat.toFixed(4)}, ${parsed.anchorLon.toFixed(4)})`);
      }
    }
  } catch (e) {}
}

async function persistCluster() {
  try {
    if (currentCluster) {
      await db.setSetting('active_cluster', JSON.stringify(currentCluster));
    } else {
      await db.setSetting('active_cluster', '');
    }
  } catch (e) {}
}

/**
 * Process an incoming location update
 * @param {object} loc 
 * @param {number} loc.lat
 * @param {number} loc.lon
 * @param {number} [loc.acc]
 * @param {number} [loc.tst]
 * @param {number} [loc.vel]
 * @returns {Promise<object>} Status report of the location processing
 */
async function processLocation(loc) {
  await loadClusterState();

  const lat = parseFloat(loc.lat);
  const lon = parseFloat(loc.lon);
  const acc = loc.acc != null ? parseFloat(loc.acc) : 0;
  const vel = loc.vel != null ? parseFloat(loc.vel) : null; // Velocity in km/h

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { status: 'skipped', reason: 'Invalid coordinates' };
  }

  // Sanitize timestamp (prevent client clock drift from breaking cooldowns)
  const nowServer = Date.now();
  let timestamp = loc.tst ? (loc.tst > 1e11 ? loc.tst : loc.tst * 1000) : nowServer;
  if (Math.abs(nowServer - timestamp) > 3600 * 1000) {
    timestamp = nowServer; // Fallback to server time if clock is desynced > 1h
  }

  // Save last known location for manual additions
  if (acc <= 65) {
    lastKnownLocation = { lat, lon, acc, timestamp };
    db.setSetting('last_location', JSON.stringify(lastKnownLocation)).catch(() => {});
  }

  // 1. Ignore poor accuracy fixes (above 45m threshold)
  if (acc > 45) {
    console.log(`[DwellTracker] Ignored fix with poor accuracy: ${Math.round(acc)}m (must be <= 45m)`);
    return { status: 'skipped', reason: `Low accuracy (${Math.round(acc)}m)` };
  }

  // 2. Velocity guard: If moving at driving speed (> 12 km/h), user is in transit
  if (vel !== null && vel > 12) {
    if (currentCluster) {
      currentCluster = null;
      await persistCluster();
    }
    return { status: 'in_transit', velocity: vel };
  }

  // 3. Check Home & Work exclusion zones
  const exclusion = checkExclusion(lat, lon, config);
  if (exclusion.excluded) {
    currentCluster = null;
    await persistCluster();
    return { status: 'excluded', reason: exclusion.reason };
  }

  // 4. Initial cluster initialization (Fixed Anchor Point)
  if (!currentCluster) {
    currentCluster = {
      anchorLat: lat,
      anchorLon: lon,
      centerLat: lat,
      centerLon: lon,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      prompted: false,
      sampleCount: 1,
      outlierCount: 0
    };
    await persistCluster();
    return { status: 'tracking', durationSeconds: 0, sampleCount: 1 };
  }

  // Measure distance from FIXED ANCHOR (prevents creeping centroid while walking)
  const distFromAnchor = getDistanceMeters(lat, lon, currentCluster.anchorLat, currentCluster.anchorLon);

  if (distFromAnchor <= config.STATIONARY_RADIUS_METERS) {
    // Still within stationary cluster
    currentCluster.outlierCount = 0;
    currentCluster.lastSeenAt = Math.max(currentCluster.lastSeenAt, timestamp);
    currentCluster.sampleCount += 1;

    // Moving average center to smooth out GPS jitter for pin display
    currentCluster.centerLat = (currentCluster.centerLat * 0.85) + (lat * 0.15);
    currentCluster.centerLon = (currentCluster.centerLon * 0.85) + (lon * 0.15);

    const dwellSeconds = Math.max(0, Math.round((currentCluster.lastSeenAt - currentCluster.firstSeenAt) / 1000));
    await persistCluster();

    console.log(`[DwellTracker] Stationary at (${currentCluster.centerLat.toFixed(4)}, ${currentCluster.centerLon.toFixed(4)}) for ${dwellSeconds}s (threshold: ${config.DWELL_THRESHOLD_SECONDS}s)`);

    // Check if dwell threshold reached and not yet prompted
    if (dwellSeconds >= config.DWELL_THRESHOLD_SECONDS && !currentCluster.prompted) {
      currentCluster.prompted = true; // Mark to prevent duplicate alerts
      await persistCluster();

      // Check cooldown for this spot
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
      console.log(`[DwellTracker] ${config.DWELL_THRESHOLD_SECONDS}s reached! Querying OpenStreetMap food places...`);
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
      }).catch(err => console.error('[DwellTracker] Telegram error:', err.message));

      // Also send ntfy push notification as backup
      await sendFoodieNotification({
        placeName: place.name,
        sessionId: sessionId,
        lat: lat,
        lon: lon,
        category: place.category
      }).catch(err => console.error('[DwellTracker] Notifier error:', err.message));

      return {
        status: 'triggered',
        dwellSeconds,
        place,
        sessionId
      };
    }

    return { status: 'dwelling', dwellSeconds, sampleCount: currentCluster.sampleCount };
  } else {
    // Jitter tolerance: allow 1 outlier sample if accuracy is loose
    currentCluster.outlierCount = (currentCluster.outlierCount || 0) + 1;
    if (currentCluster.outlierCount <= 1 && acc > 20) {
      return { status: 'jitter_ignored', distance: Math.round(distFromAnchor) };
    }

    // User moved away to a new spot
    console.log(`[DwellTracker] Moved ${Math.round(distFromAnchor)}m from anchor. Starting new cluster.`);
    currentCluster = {
      anchorLat: lat,
      anchorLon: lon,
      centerLat: lat,
      centerLon: lon,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      prompted: false,
      sampleCount: 1,
      outlierCount: 0
    };
    await persistCluster();
    return { status: 'moved', distanceMeters: Math.round(distFromAnchor) };
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
  persistCluster();
}

module.exports = {
  processLocation,
  getClusterState,
  getLastLocation,
  resetCluster
};
