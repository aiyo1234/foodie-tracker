const config = require('../config');
const db = require('../db');
const path = require('path');
const fs = require('fs');

// In-memory conversation state for active ratings
// sessionId -> { step: 'awaiting_comment', rating: 5, pendingData }
const activeSessions = new Map();
let storedChatId = config.TELEGRAM_CHAT_ID;

/**
 * Send HTTP request to Telegram Bot API
 */
async function callTelegram(method, payload) {
  if (!config.TELEGRAM_BOT_TOKEN) return null;

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error(`[Telegram] Error calling ${method}:`, err.message);
    return null;
  }
}

/**
 * Sends the interactive 1-tap rating message directly inside Telegram
 * Offers nearby candidate stalls if multiple are detected
 */
async function sendTelegramFoodiePrompt({ placeName, sessionId, lat, lon, category, candidates = [] }) {
  if (!storedChatId) {
    storedChatId = await db.getSetting('telegram_chat_id');
  }

  if (!config.TELEGRAM_BOT_TOKEN || !storedChatId) {
    console.warn('[Telegram] Cannot send alert: BOT_TOKEN or CHAT_ID not configured yet. (Send /start to @daweidaiii_bot)');
    return false;
  }

  let message = '';
  const inlineKeyboard = [];

  if (candidates && candidates.length > 1) {
    // Multi-candidate mode: User can pick from nearby detected stalls or type their own!
    message = `🍽️ *Foodie Alert: Which food stall are you at?*\n\nWe detected a few eateries around your location. Tap your stall:`;

    candidates.slice(0, 4).forEach((c, idx) => {
      const icons = ['🍜', '🍛', '☕', '🍱'];
      const icon = icons[idx] || '🍴';
      inlineKeyboard.push([
        { text: `${icon} ${c.name} (~${c.distance}m)`, callback_data: `pick_candidate:${idx}:${sessionId}` }
      ]);
    });

    inlineKeyboard.push([
      { text: '✏️ Different Stall / Type Name', callback_data: `rename_store:${sessionId}` }
    ]);
    inlineKeyboard.push([
      { text: '❌ Not an eatery / Ignore', callback_data: `dismiss:${sessionId}` }
    ]);
  } else {
    // Single place detected: Show rating stars + option to correct name if wrong!
    message = `🍽️ *Foodie Alert: Are you at ${escapeMarkdown(placeName)}?*\n\nTap a rating below (or change the name if incorrect):`;

    inlineKeyboard.push([
      { text: '⭐ 1', callback_data: `rate:1:${sessionId}` },
      { text: '⭐ 2', callback_data: `rate:2:${sessionId}` },
      { text: '⭐ 3', callback_data: `rate:3:${sessionId}` },
      { text: '⭐ 4', callback_data: `rate:4:${sessionId}` },
      { text: '⭐ 5', callback_data: `rate:5:${sessionId}` }
    ]);
    inlineKeyboard.push([
      { text: '✏️ Wrong Store / Change Name', callback_data: `rename_store:${sessionId}` }
    ]);
    inlineKeyboard.push([
      { text: '❌ Not an eatery / Ignore', callback_data: `dismiss:${sessionId}` }
    ]);
  }

  const res = await callTelegram('sendMessage', {
    chat_id: storedChatId,
    text: message,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: inlineKeyboard }
  });

  return res && res.ok;
}

/**
 * Handles incoming webhooks from Telegram
 */
async function handleTelegramWebhook(body) {
  // 1. Handle Callback Query (User tapped a button)
  if (body.callback_query) {
    const query = body.callback_query;
    const data = query.data || '';
    const chatId = query.message.chat.id;
    storedChatId = chatId;

    await callTelegram('answerCallbackQuery', { callback_query_id: query.id });

    // User picked one of the nearby candidates
    if (data.startsWith('pick_candidate:')) {
      const parts = data.split(':');
      const idx = parseInt(parts[1], 10);
      const sessionId = parts[2];

      const pending = await db.getPendingById(sessionId);
      let storeName = 'Selected Food Stall';
      if (pending && pending.candidates_json) {
        try {
          const cands = JSON.parse(pending.candidates_json);
          if (cands[idx]) storeName = cands[idx].name;
        } catch (e) {}
      }

      activeSessions.set(chatId, {
        step: 'awaiting_rating',
        sessionId,
        storeName,
        pending
      });

      const inlineKeyboard = [
        [
          { text: '⭐ 1', callback_data: `named_rate:1:${sessionId}` },
          { text: '⭐ 2', callback_data: `named_rate:2:${sessionId}` },
          { text: '⭐ 3', callback_data: `named_rate:3:${sessionId}` },
          { text: '⭐ 4', callback_data: `named_rate:4:${sessionId}` },
          { text: '⭐ 5', callback_data: `named_rate:5:${sessionId}` }
        ],
        [
          { text: '✏️ Different Name', callback_data: `rename_store:${sessionId}` }
        ]
      ];

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `You selected *${escapeMarkdown(storeName)}*! Tap your rating:`,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
      return;
    }

    // User requested to change / type a custom store name
    if (data.startsWith('rename_store:')) {
      const sessionId = data.split(':')[1];
      const pending = await db.getPendingById(sessionId);

      activeSessions.set(chatId, {
        flow: 'rename_store',
        sessionId,
        pending
      });

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `✏️ *What is the correct name of the food stall you're at?*\n\nType the name below and send:`,
        parse_mode: 'Markdown'
      });
      return;
    }

    // User rated after selecting a candidate or typing name
    if (data.startsWith('named_rate:')) {
      const parts = data.split(':');
      const rating = parseInt(parts[1], 10);
      const sessionId = parts[2];

      const session = activeSessions.get(chatId) || {};
      const storeName = session.storeName || (session.pending ? session.pending.name : 'Food Stall');

      activeSessions.set(chatId, {
        step: 'awaiting_comment',
        rating,
        sessionId,
        storeName,
        pending: session.pending
      });

      const stars = '⭐'.repeat(rating);
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `You rated *${escapeMarkdown(storeName)}* ${stars}!\n\n💬 *Type your review or food notes below* (or send a food photo!):`,
        parse_mode: 'Markdown'
      });
      return;
    }

    if (data.startsWith('rate:')) {
      const parts = data.split(':');
      const rating = parseInt(parts[1], 10);
      const sessionId = parts[2];

      const pending = await db.getPendingById(sessionId);
      const storeName = pending ? pending.name : 'this food stall';

      activeSessions.set(chatId, {
        step: 'awaiting_comment',
        rating,
        sessionId,
        storeName,
        pending
      });

      const stars = '⭐'.repeat(rating);
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `You rated *${escapeMarkdown(storeName)}* ${stars}!\n\n💬 *Type your review or food notes below* (or send a food photo!):`,
        parse_mode: 'Markdown'
      });
      return;
    }

    if (data.startsWith('manual_rate:')) {
      const parts = data.split(':');
      const rating = parseInt(parts[1], 10);
      const tempId = parts[2];

      const manualSession = activeSessions.get(chatId);
      if (manualSession) {
        manualSession.rating = rating;
        manualSession.step = 'awaiting_comment';

        const stars = '⭐'.repeat(rating);
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: `You rated *${escapeMarkdown(manualSession.name)}* ${stars}!\n\n💬 *Type your review or food notes below* (or send a food photo!):`,
          parse_mode: 'Markdown'
        });
      }
      return;
    }

    if (data.startsWith('dismiss:')) {
      const sessionId = data.split(':')[1];
      await db.resolvePending(sessionId, 'dismissed');
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: '👍 Ignored. Enjoy your day!'
      });
      return;
    }
  }

  // 2. Handle Normal Messages (Text replies, Photos, /start)
  if (body.message) {
    const msg = body.message;
    const chatId = msg.chat.id;
    storedChatId = chatId;
    await db.setSetting('telegram_chat_id', chatId);
    const text = (msg.text || '').trim();

    // Universal GPS Location Handler: Catches any shared location (via button or paperclip)
    if (msg.location) {
      const lat = msg.location.latitude;
      const lon = msg.location.longitude;
      const { findNearbyFoodPlace } = require('./osmService');
      const place = await findNearbyFoodPlace(lat, lon);

      const sessionId = 'manual_' + Date.now();
      await db.insertPending({
        id: sessionId,
        name: place.name || 'Local Food Spot',
        candidates: place.candidates || [],
        lat: lat,
        lon: lon,
        address: place.address || `GPS (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
        category: place.category || 'Food Stall',
        created_at: Date.now()
      });

      activeSessions.set(chatId, {
        sessionId,
        lat,
        lon,
        address: place.address,
        candidates: place.candidates
      });

      const inlineKeyboard = [];
      if (place.candidates && place.candidates.length > 0) {
        place.candidates.slice(0, 4).forEach((c, idx) => {
          const icons = ['🍜', '🍛', '☕', '🍱'];
          const icon = icons[idx] || '🍴';
          inlineKeyboard.push([
            { text: `${icon} ${c.name} (~${c.distance}m)`, callback_data: `pick_candidate:${idx}:${sessionId}` }
          ]);
        });
      }

      inlineKeyboard.push([
        { text: '✏️ Type Food Stall Name', callback_data: `rename_store:${sessionId}` }
      ]);
      inlineKeyboard.push([
        { text: '❌ Cancel', callback_data: `dismiss:${sessionId}` }
      ]);

      const promptText = place.candidates && place.candidates.length > 0
        ? `📍 *GPS Location received!* Which food stall are you at?`
        : `📍 *GPS Location received!* Tap below to type the food stall name:`;

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: promptText,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
      return;
    }

    // Command: /start or Persistent Menu
    if (text === '/start') {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `👋 *Welcome to your Foodie Tracker Bot!*\n\n• I will automatically message you when you stay at a food stall for 2+ minutes.\n• You can also tap the button below anytime to add an unmapped stall manually!`,
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [
            [{ text: '➕ Add Food Stall Manually' }, { text: '📋 View My List' }]
          ],
          resize_keyboard: true
        }
      });
      return;
    }

    // Button / Command: ➕ Add Food Stall Manually
    if (text === '➕ Add Food Stall Manually' || text === '/add') {
      activeSessions.set(chatId, {
        flow: 'manual_add',
        step: 'awaiting_location'
      });

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `📍 *Let's add an unmapped food stall!*\n\nTap the button below to send your current location, or type the area/street name:`,
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [
            [{ text: '📍 Share Current GPS Location', request_location: true }],
            [{ text: '❌ Cancel' }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      });
      return;
    }

    // Handle Cancel
    if (text === '❌ Cancel') {
      activeSessions.delete(chatId);
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: 'Action cancelled.',
        reply_markup: {
          keyboard: [[{ text: '➕ Add Food Stall Manually' }, { text: '📋 View My List' }]],
          resize_keyboard: true
        }
      });
      return;
    }

    // Check if in manual add flow
    const manualSession = activeSessions.get(chatId);
    if (manualSession && manualSession.flow === 'manual_add') {
      // Step A: Received Location
      if (manualSession.step === 'awaiting_location') {
        let lat = 0, lon = 0, address = '';
        if (msg.location) {
          lat = msg.location.latitude;
          lon = msg.location.longitude;
          address = `GPS (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
        } else {
          // User typed text address/street
          address = text;
          // Fallback to recent cluster coordinates if available
          const lastCluster = require('./dwellTracker').getClusterState();
          lat = lastCluster ? lastCluster.centerLat : 2.30206;
          lon = lastCluster ? lastCluster.centerLon : 111.86868;
        }

        manualSession.step = 'awaiting_name';
        manualSession.lat = lat;
        manualSession.lon = lon;
        manualSession.address = address;

        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: `🍜 *Got location!* Now, what is the name of this food stall?`,
          parse_mode: 'Markdown',
          reply_markup: { remove_keyboard: true }
        });
        return;
      }

      // Step B: Received Store Name
      if (manualSession.step === 'awaiting_name') {
        const storeName = text;
        manualSession.name = storeName;
        manualSession.step = 'awaiting_rating';
        const tempId = 'manual_' + Date.now();
        manualSession.sessionId = tempId;

        const inlineKeyboard = [
          [
            { text: '⭐ 1', callback_data: `manual_rate:1:${tempId}` },
            { text: '⭐ 2', callback_data: `manual_rate:2:${tempId}` },
            { text: '⭐ 3', callback_data: `manual_rate:3:${tempId}` },
            { text: '⭐ 4', callback_data: `manual_rate:4:${tempId}` },
            { text: '⭐ 5', callback_data: `manual_rate:5:${tempId}` }
          ]
        ];

        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: `Rate *${escapeMarkdown(storeName)}*:`,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
        return;
      }
    }

    // Check if user is typing the correct name for a detected stall
    const renameSession = activeSessions.get(chatId);
    if (renameSession && renameSession.flow === 'rename_store') {
      const storeName = text;
      renameSession.storeName = storeName;
      renameSession.flow = null;
      renameSession.step = 'awaiting_rating';

      const inlineKeyboard = [
        [
          { text: '⭐ 1', callback_data: `named_rate:1:${renameSession.sessionId}` },
          { text: '⭐ 2', callback_data: `named_rate:2:${renameSession.sessionId}` },
          { text: '⭐ 3', callback_data: `named_rate:3:${renameSession.sessionId}` },
          { text: '⭐ 4', callback_data: `named_rate:4:${renameSession.sessionId}` },
          { text: '⭐ 5', callback_data: `named_rate:5:${renameSession.sessionId}` }
        ]
      ];

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `Got it! Rate *${escapeMarkdown(storeName)}*:`,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
      return;
    }

    // Command: /list (View recent reviews)
    if (text === '/list' || text === '📋 View My List') {
      const rawReviews = await db.getReviews();
      const reviews = rawReviews.slice(0, 5);
      if (reviews.length === 0) {
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: 'No food spots saved yet! Visit an eatery to get started.'
        });
        return;
      }
      let report = '🍜 *Your Recent Foodie Spots:*\n\n';
      reviews.forEach(r => {
        report += `• *${escapeMarkdown(r.name)}* - ${'⭐'.repeat(r.rating)}\n  "${escapeMarkdown(r.comment || 'Good food')}"\n  [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon})\n\n`;
      });
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: report,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      return;
    }

    // Check if user is replying to an active rating prompt
    const active = activeSessions.get(chatId);
    if (active && active.step === 'awaiting_comment') {
      let comment = text;
      let photoUrl = null;

      // Check if user sent a photo
      if (msg.photo && msg.photo.length > 0) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        comment = msg.caption || comment || 'Delicious meal';
        photoUrl = await downloadTelegramFile(fileId);
      }

      const pending = active.pending;
      const reviewId = 'rev_' + Date.now();

      const review = {
        id: reviewId,
        name: active.storeName || active.name || (pending ? pending.name : 'Local Food Spot'),
        lat: active.lat !== undefined ? active.lat : (pending ? pending.lat : 0),
        lon: active.lon !== undefined ? active.lon : (pending ? pending.lon : 0),
        address: active.address || (pending ? pending.address : ''),
        rating: active.rating,
        comment: comment || 'Rated via Telegram',
        photo_url: photoUrl,
        category: pending ? pending.category : 'Food Stall',
        created_at: Date.now()
      };

      await db.insertReview(review);
      if (active.sessionId && !active.sessionId.startsWith('manual_')) {
        await db.resolvePending(active.sessionId, 'completed');
      }

      activeSessions.delete(chatId);

      const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${review.lat},${review.lon}`;

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `✅ *Saved to your Google Maps Foodie List!*\n\n📍 *${escapeMarkdown(review.name)}*\nRating: ${'⭐'.repeat(review.rating)}\nComment: "${escapeMarkdown(review.comment)}"\n\n🗺️ [View on Google Maps](${gmapsUrl})`,
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [
            [{ text: '➕ Add Food Stall Manually' }, { text: '📋 View My List' }]
          ],
          resize_keyboard: true
        }
      });
      return;
    }
  }
}

/**
 * Downloads a photo from Telegram API and saves to /uploads
 */
async function downloadTelegramFile(fileId) {
  try {
    const fileInfo = await callTelegram('getFile', { file_id: fileId });
    if (!fileInfo || !fileInfo.result || !fileInfo.result.file_path) return null;

    const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`;
    const filename = `food-tg-${Date.now()}.jpg`;
    const destPath = path.join(config.UPLOADS_DIR, filename);

    const res = await fetch(fileUrl);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);

    return `/uploads/${filename}`;
  } catch (err) {
    console.error('[Telegram] Failed to download photo:', err.message);
    return null;
  }
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

module.exports = {
  sendTelegramFoodiePrompt,
  handleTelegramWebhook,
  setStoredChatId: (id) => { storedChatId = id; }
};
