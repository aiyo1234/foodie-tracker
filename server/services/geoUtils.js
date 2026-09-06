/**
 * Calculate the great-circle distance between two points on the Earth (Haversine formula).
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in meters
 */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return Infinity;
  }

  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  // Clamp 'a' to [0, 1] to prevent Math.sqrt(< 0) resulting in NaN
  const safeA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(safeA), Math.sqrt(1 - safeA));
  return R * c;
}

/**
 * Checks if a given coordinate falls within configured exclusion zones (Home, Work)
 * @param {number} lat 
 * @param {number} lon 
 * @param {object} config 
 * @returns {{ excluded: boolean, reason?: string }}
 */
function checkExclusion(lat, lon, config) {
  if (Number.isFinite(config.HOME_LAT) && Number.isFinite(config.HOME_LON)) {
    const dist = getDistanceMeters(lat, lon, config.HOME_LAT, config.HOME_LON);
    if (dist <= config.HOME_RADIUS_METERS) {
      return { excluded: true, reason: `Inside Home exclusion zone (${Math.round(dist)}m)` };
    }
  }

  if (Number.isFinite(config.WORK_LAT) && Number.isFinite(config.WORK_LON)) {
    const dist = getDistanceMeters(lat, lon, config.WORK_LAT, config.WORK_LON);
    if (dist <= config.WORK_RADIUS_METERS) {
      return { excluded: true, reason: `Inside Work exclusion zone (${Math.round(dist)}m)` };
    }
  }

  return { excluded: false };
}

module.exports = {
  getDistanceMeters,
  checkExclusion
};
