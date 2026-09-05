const config = require('../config');

/**
 * Sends an interactive push notification to the user's iPhone via ntfy.sh
 * 
 * @param {object} params
 * @param {string} params.placeName
 * @param {string} params.sessionId
 * @param {number} params.lat
 * @param {number} params.lon
 * @param {string} [params.category]
 * @returns {Promise<boolean>}
 */
async function sendFoodieNotification({ placeName, sessionId, lat, lon, category = 'Food Spot' }) {
  const reviewUrl = `${config.BASE_URL}/review.html?session=${sessionId}`;
  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

  const payload = {
    topic: config.NTFY_TOPIC,
    title: `🍽️ Foodie Alert: ${placeName}`,
    message: `You've been at this ${category.toLowerCase()} for 5+ minutes. Tap to rate your food, add notes & snap a photo!`,
    priority: 4, // High priority
    tags: ['plate_with_cutlery', 'star'],
    click: reviewUrl,
    actions: [
      {
        action: 'view',
        label: '⭐ Rate & Review',
        url: reviewUrl,
        clear: true
      },
      {
        action: 'view',
        label: '🗺️ Open in Google Maps',
        url: gmapsUrl
      }
    ]
  };

  try {
    const res = await fetch(`${config.NTFY_SERVER}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      console.log(`[Notifier] Push notification dispatched to topic: ${config.NTFY_TOPIC} for "${placeName}"`);
      return true;
    } else {
      const text = await res.text();
      console.warn(`[Notifier] ntfy returned status ${res.status}:`, text);
      return false;
    }
  } catch (err) {
    console.error('[Notifier] Failed to send push notification:', err.message);
    return false;
  }
}

module.exports = {
  sendFoodieNotification
};
