/**
 * Calculate the great-circle distance between two points on the Earth (Haversine formula).
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in meters
 */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  if (config.HOME_LAT && config.HOME_LON) {
    const dist = getDistanceMeters(lat, lon, config.HOME_LAT, config.HOME_LON);
    if (dist <= config.HOME_RADIUS_METERS) {
      return { excluded: true, reason: `Inside Home exclusion zone (${Math.round(dist)}m)` };
    }
  }

  if (config.WORK_LAT && config.WORK_LON) {
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
