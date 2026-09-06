const { getDistanceMeters } = require('./geoUtils');

/**
 * Queries OpenStreetMap Overpass API for nearby food amenities.
 * Falls back to Nominatim reverse geocoding if Overpass returns empty or times out.
 * 
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} radiusMeters 
 * @returns {Promise<{ name: string, category: string, address: string, candidates: Array<{ name: string, category: string, distance: number }> }>}
 */
const USER_AGENT = 'FoodieTrackerApp/1.0 (+https://github.com/aiyo1234/foodie-tracker; contact: foodie-tracker-bot@gmail.com)';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

async function findNearbyFoodPlace(lat, lon, radiusMeters = 50) {
  const overpassQuery = `
    [out:json][timeout:8];
    (
      node["amenity"~"restaurant|cafe|fast_food|food_court|ice_cream|bar|pub"](around:${radiusMeters},${lat},${lon});
      way["amenity"~"restaurant|cafe|fast_food|food_court|ice_cream|bar|pub"](around:${radiusMeters},${lat},${lon});
      node["shop"~"bakery|deli|confectionery"](around:${radiusMeters},${lat},${lon});
      way["shop"~"bakery|deli|confectionery"](around:${radiusMeters},${lat},${lon});
    );
    out center 8;
  `.trim();

  // Try primary and secondary Overpass endpoints
  for (const endpoint of OVERPASS_ENDPOINTS) {
    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 8500);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT
        },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: controller.signal
      });

      if (response.ok) {
        const data = await response.json();
        if (data.elements && data.elements.length > 0) {
          const rawCandidates = data.elements
            .map(el => {
              const pLat = el.lat || (el.center && el.center.lat);
              const pLon = el.lon || (el.center && el.center.lon);
              const tags = el.tags || {};
              const dist = pLat && pLon ? Math.round(getDistanceMeters(lat, lon, pLat, pLon)) : 0;
              const name = tags.name || tags['name:en'] || tags.brand || '';
              const category = tags.amenity || tags.shop || 'restaurant';
              const cuisine = tags.cuisine ? ` (${tags.cuisine})` : '';

              return {
                name: name ? `${name}${cuisine}` : '',
                category: formatCategory(category),
                address: tags['addr:street'] ? `${tags['addr:housenumber'] || ''} ${tags['addr:street']}`.trim() : '',
                distance: dist
              };
            })
            .filter(c => c.name.length > 0)
            .sort((a, b) => a.distance - b.distance);

          // Deduplicate candidates by name
          const seenNames = new Set();
          const candidates = [];
          for (const c of rawCandidates) {
            const cleanName = c.name.toLowerCase().trim();
            if (!seenNames.has(cleanName)) {
              seenNames.add(cleanName);
              candidates.push(c);
            }
          }

          if (candidates.length > 0) {
            const primary = candidates[0];
            return {
              name: primary.name,
              category: primary.category,
              address: primary.address || `Near ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
              candidates: candidates.slice(0, 4)
            };
          }
        }
      }
    } catch (err) {
      console.warn(`[OSM] Overpass query to ${endpoint} failed:`, err.message);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // Fallback to Nominatim Reverse Geocoding
  return await reverseGeocodeNominatim(lat, lon);
}

/**
 * Nominatim reverse geocoding fallback
 */
async function reverseGeocodeNominatim(lat, lon) {
  let timeoutId;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 6000);

    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT
      },
      signal: controller.signal
    });

    if (response.ok) {
      const data = await response.json();
      const addr = data.address || {};
      const road = addr.road || addr.pedestrian || addr.suburb || '';
      const formattedAddress = [road, addr.city || addr.town || addr.village || ''].filter(Boolean).join(', ') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

      return {
        name: data.name || (road ? `Food Spot on ${road}` : 'Local Food Spot'),
        category: 'Eatery',
        address: formattedAddress,
        candidates: []
      };
    }
  } catch (err) {
    console.warn('[OSM] Nominatim reverse geocoding failed:', err.message);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  // Final fallback if offline or geocoders unavailable
  return {
    name: 'Food Stall / Restaurant',
    category: 'Eatery',
    address: `GPS (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
    candidates: []
  };
}

function formatCategory(raw) {
  const map = {
    restaurant: 'Restaurant',
    cafe: 'Cafe',
    fast_food: 'Fast Food / Stall',
    food_court: 'Food Court',
    ice_cream: 'Dessert / Ice Cream',
    bakery: 'Bakery',
    pub: 'Pub / Bar',
    bar: 'Bar'
  };
  return map[raw] || 'Eatery';
}

module.exports = {
  findNearbyFoodPlace
};
