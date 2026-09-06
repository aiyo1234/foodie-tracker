const config = require('../config');
const db = require('../db');
const path = require('path');
const fs = require('fs');

let storedChatId = config.TELEGRAM_CHAT_ID;

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send HTTP request to Telegram Bot API with timeout & auto plain-text retry
 */
async function callTelegram(method, payload) {
  if (!config.TELEGRAM_BOT_TOKEN) return null;

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();

    // If HTML formatting ever triggers 400 Bad Request, retry immediately as plain text
    if (!data.ok && data.error_code === 400 && payload.parse_mode && payload.text) {
      console.warn(`[Telegram] Formatting rejected (${data.description}). Retrying as plain text.`);
      const fallbackPayload = { ...payload };
      delete fallbackPayload.parse_mode;
      fallbackPayload.text = payload.text.replace(/<[^>]*>/g, '');
      const retryRes = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallbackPayload),
        signal: AbortSignal.timeout(10000)
      });
      return await retryRes.json();
    }

    return data;
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
    message = `🍽️ <b>Foodie Alert: Which food stall are you at?</b>\n\nWe detected a few eateries around your location. Tap your stall:`;

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
    message = `🍽️ <b>Foodie Alert: Are you at ${escapeHtml(placeName)}?</b>\n\nTap a rating below (or change the name if incorrect):`;

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
    parse_mode: 'HTML',
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
    await db.setSetting('telegram_chat_id', chatId);

    await callTelegram('answerCallbackQuery', { callback_query_id: query.id });

    // Remove buttons from original message to prevent double-tap race conditions
    callTelegram('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: { inline_keyboard: [] }
    }).catch(() => {});

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

      await db.setBotSession(chatId, {
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
        text: `You selected <b>${escapeHtml(storeName)}</b>! Tap your rating:`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
      return;
    }

    // User requested to change / type a custom store name
    if (data.startsWith('rename_store:')) {
      const sessionId = data.split(':')[1];
      const pending = await db.getPendingById(sessionId);

      await db.setBotSession(chatId, {
        flow: 'rename_store',
        sessionId,
        pending
      });

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `✏️ <b>What is the correct name of the food stall you're at?</b>\n\nType the name below and send:`,
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [[{ text: '❌ Cancel' }]],
          resize_keyboard: true
        }
      });
      return;
    }

    // User rated after selecting a candidate or typing name
    if (data.startsWith('named_rate:')) {
      const parts = data.split(':');
      const rating = parseInt(parts[1], 10);
      const sessionId = parts[2];

      const session = (await db.getBotSession(chatId)) || {};
      const storeName = session.storeName || (session.pending ? session.pending.name : 'Food Stall');

      await db.setBotSession(chatId, {
        step: 'awaiting_comment',
        rating,
        sessionId,
        storeName,
        pending: session.pending
      });

      const stars = '⭐'.repeat(rating);
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `You rated <b>${escapeHtml(storeName)}</b> ${stars}!\n\n💬 <b>Type your review or food notes below</b> (or send a food photo!):`,
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [[{ text: '❌ Cancel' }]],
          resize_keyboard: true
        }
      });
      return;
    }

    if (data.startsWith('rate:')) {
      const parts = data.split(':');
      const rating = parseInt(parts[1], 10);
      const sessionId = parts[2];

      const pending = await db.getPendingById(sessionId);
      const storeName = pending ? pending.name : 'this food stall';

      await db.setBotSession(chatId, {
        step: 'awaiting_comment',
        rating,
        sessionId,
        storeName,
        pending
      });

      const stars = '⭐'.repeat(rating);
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `You rated <b>${escapeHtml(storeName)}</b> ${stars}!\n\n💬 <b>Type your review or food notes below</b> (or send a food photo!):`,
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [[{ text: '❌ Cancel' }]],
          resize_keyboard: true
        }
      });
      return;
    }

    if (data.startsWith('manual_rate:')) {
      const parts = data.split(':');
      const rating = parseInt(parts[1], 10);
      const tempId = parts[2];

      const manualSession = await db.getBotSession(chatId);
      if (manualSession) {
        manualSession.rating = rating;
        manualSession.step = 'awaiting_comment';
        await db.setBotSession(chatId, manualSession);

        const stars = '⭐'.repeat(rating);
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: `You rated <b>${escapeHtml(manualSession.name)}</b> ${stars}!\n\n💬 <b>Type your review or food notes below</b> (or send a food photo!):`,
          parse_mode: 'HTML',
          reply_markup: {
            keyboard: [[{ text: '❌ Cancel' }]],
            resize_keyboard: true
          }
        });
      }
      return;
    }

    if (data.startsWith('dismiss:')) {
      const sessionId = data.split(':')[1];
      await db.resolvePending(sessionId, 'dismissed');
      await db.deleteBotSession(chatId);
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: '👍 Ignored. Enjoy your meal!'
      });
      return;
    }
  }

  // 2. Handle Normal Messages (Text replies, Photos, /start, Commands)
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

      await db.setBotSession(chatId, {
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
        ? `📍 <b>GPS Location received!</b> Which food stall are you at?`
        : `📍 <b>GPS Location received!</b> Tap below to type the food stall name:`;

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: promptText,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
      return;
    }

    // Command: /start
    if (text === '/start') {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `👋 <b>Welcome to your Foodie Tracker Bot!</b>\n\n• I will automatically message you when you stay at a food stall for 2.5+ minutes.\n• You can also tap the button below anytime to add an unmapped stall manually!\n\n<b>Commands:</b>\n/help - Show full usage guide\n/status - Check background GPS & tracking status\n/undo - Delete the latest saved food spot\n/list - View your recent food spots`,
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '➕ Add Food Stall Manually' }, { text: '📋 View My List' }]
          ],
          resize_keyboard: true
        }
      });
      return;
    }

    // Command: /help
    if (text === '/help') {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `📖 <b>Foodie Tracker Help & Guide</b>\n\n1. <b>Automatic Dwell Detection:</b>\nWhen OwnTracks detects you have stayed at a restaurant/hawker center for 2.5+ minutes, I will send you an alert with nearby stall choices or 1-tap rating buttons.\n\n2. <b>Manual Addition:</b>\nTap <b>➕ Add Food Stall Manually</b> to log any food stall even if it is not listed on Google Maps. Your phone's background GPS will be automatically linked.\n\n3. <b>Google Maps Sync:</b>\nEvery saved spot is saved permanently to Turso Cloud SQLite and is available at <code>/api/map.csv</code> and <code>/api/map.kml</code> for instant import into Google My Maps.\n\n4. <b>Commands:</b>\n• /status - Diagnostics\n• /undo - Remove last review\n• /cancel - Cancel current action`,
        parse_mode: 'HTML'
      });
      return;
    }

    // Command: /status
    if (text === '/status') {
      const dwellTracker = require('./dwellTracker');
      const cluster = dwellTracker.getClusterState();
      const lastLoc = await dwellTracker.getLastLocation();
      const allReviews = await db.getReviews();

      let statusMsg = `📊 <b>Foodie Tracker Status:</b>\n\n`;
      statusMsg += `• <b>Total Saved Spots:</b> ${allReviews.length}\n`;

      if (lastLoc) {
        const ageSec = Math.round((Date.now() - lastLoc.timestamp) / 1000);
        statusMsg += `• <b>Last Known GPS:</b> ${lastLoc.lat.toFixed(4)}, ${lastLoc.lon.toFixed(4)} (±${Math.round(lastLoc.acc)}m, ${ageSec}s ago)\n`;
      } else {
        statusMsg += `• <b>Last Known GPS:</b> No GPS fixes received yet\n`;
      }

      if (cluster) {
        const dwellSec = Math.max(0, Math.round((cluster.lastSeenAt - cluster.firstSeenAt) / 1000));
        statusMsg += `• <b>Active Cluster:</b> Dwelling at (${cluster.anchorLat.toFixed(4)}, ${cluster.anchorLon.toFixed(4)}) for ${dwellSec}s (Threshold: ${config.DWELL_THRESHOLD_SECONDS}s)\n`;
      } else {
        statusMsg += `• <b>Active Cluster:</b> Idle / Moving\n`;
      }

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: statusMsg,
        parse_mode: 'HTML'
      });
      return;
    }

    // Command: /undo (Delete last review)
    if (text === '/undo' || text === '/delete_last') {
      const deleted = await db.deleteLatestReview();
      if (deleted) {
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: `🗑️ <b>Deleted:</b> <i>${escapeHtml(deleted.name)}</i> was removed from your food list.`,
          parse_mode: 'HTML'
        });
      } else {
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: 'No reviews found to delete.',
          parse_mode: 'HTML'
        });
      }
      return;
    }

    // Button / Command: ➕ Add Food Stall Manually
    if (text === '➕ Add Food Stall Manually' || text === '/add') {
      await db.setBotSession(chatId, {
        flow: 'manual_add',
        step: 'awaiting_name'
      });

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `🍜 <b>Adding a food stall!</b>\n\nWhat is the name of the food stall you're at?\n<i>(Type the name below and send):</i>`,
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '❌ Cancel' }]
          ],
          resize_keyboard: true
        }
      });
      return;
    }

    // Handle Cancel
    if (text === '❌ Cancel' || text === '/cancel') {
      await db.deleteBotSession(chatId);
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: 'Action cancelled.',
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [[{ text: '➕ Add Food Stall Manually' }, { text: '📋 View My List' }]],
          resize_keyboard: true
        }
      });
      return;
    }

    // Check if in manual add flow: Received Store Name directly!
    const manualSession = await db.getBotSession(chatId);
    if (manualSession && manualSession.flow === 'manual_add' && manualSession.step === 'awaiting_name') {
      const storeName = text;
      
      // Automatically grab the phone's live GPS coordinates from OwnTracks
      const dwellTracker = require('./dwellTracker');
      const lastCluster = dwellTracker.getClusterState();
      const lastLoc = await dwellTracker.getLastLocation();
      const lat = (lastCluster && (lastCluster.anchorLat || lastCluster.centerLat)) || (lastLoc && lastLoc.lat) || 2.30206;
      const lon = (lastCluster && (lastCluster.anchorLon || lastCluster.centerLon)) || (lastLoc && lastLoc.lon) || 111.86868;

      manualSession.name = storeName;
      manualSession.lat = lat;
      manualSession.lon = lon;
      manualSession.address = `GPS (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
      manualSession.step = 'awaiting_rating';
      const tempId = 'manual_' + Date.now();
      manualSession.sessionId = tempId;

      await db.setBotSession(chatId, manualSession);

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
        text: `Rate <b>${escapeHtml(storeName)}</b>:`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
      return;
    }

    // Check if user is typing the correct name for a detected stall
    const renameSession = await db.getBotSession(chatId);
    if (renameSession && renameSession.flow === 'rename_store') {
      const storeName = text;
      renameSession.storeName = storeName;
      renameSession.flow = null;
      renameSession.step = 'awaiting_rating';
      await db.setBotSession(chatId, renameSession);

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
        text: `Got it! Rate <b>${escapeHtml(storeName)}</b>:`,
        parse_mode: 'HTML',
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
          text: 'No food spots saved yet! Visit an eatery or tap <b>➕ Add Food Stall Manually</b> to get started.',
          parse_mode: 'HTML'
        });
        return;
      }
      let report = '🍜 <b>Your Recent Foodie Spots:</b>\n\n';
      reviews.forEach(r => {
        const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name)}+${r.lat},${r.lon}`;
        const appleUrl = `https://maps.apple.com/?q=${encodeURIComponent(r.name)}&ll=${r.lat},${r.lon}`;
        report += `• <b>${escapeHtml(r.name)}</b> - ${'⭐'.repeat(r.rating)}\n  "<i>${escapeHtml(r.comment || 'Good food')}</i>"\n  📍 <a href="${gmapsUrl}">Google Maps</a> | <a href="${appleUrl}">Apple Maps</a>\n\n`;
      });
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: report,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      return;
    }

    // Check if user is replying to an active rating prompt
    const active = await db.getBotSession(chatId);
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
        rating: active.rating || 5,
        comment: comment || 'Rated via Telegram',
        photo_url: photoUrl,
        category: pending ? pending.category : 'Food Stall',
        created_at: Date.now()
      };

      await db.insertReview(review);
      if (active.sessionId && !active.sessionId.startsWith('manual_')) {
        await db.resolvePending(active.sessionId, 'completed');
      }

      await db.deleteBotSession(chatId);

      const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(review.name)}+${review.lat},${review.lon}`;
      const appleMapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(review.name)}&ll=${review.lat},${review.lon}`;

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `✅ <b>Saved to your Google Maps Foodie List!</b>\n\n📍 <b>${escapeHtml(review.name)}</b>\nRating: ${'⭐'.repeat(review.rating)}\nComment: "<i>${escapeHtml(review.comment)}</i>"\n\n🗺️ <a href="${gmapsUrl}">Open in Google Maps</a>\n🧭 <a href="${appleMapsUrl}">Open in Apple Maps</a>`,
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '➕ Add Food Stall Manually' }, { text: '📋 View My List' }]
          ],
          resize_keyboard: true
        }
      });
      return;
    }

    // Default fallback handler for unrecognized text
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: `👋 <b>Foodie Tracker Bot</b>\n\nI didn't recognize that command.\n\n• Tap <b>➕ Add Food Stall Manually</b> to log a stall\n• Tap <b>📋 View My List</b> to see your spots\n• Send <b>/status</b> to check tracking diagnostics\n• Send <b>/help</b> for instructions`,
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [
          [{ text: '➕ Add Food Stall Manually' }, { text: '📋 View My List' }]
        ],
        resize_keyboard: true
      }
    });
  }
}

/**
 * Downloads a photo from Telegram API and saves to /uploads asynchronously
 * Returns permanent proxy URL /api/reviews/photos/tg/:fileId so photos never 404
 */
async function downloadTelegramFile(fileId) {
  try {
    const fileInfo = await callTelegram('getFile', { file_id: fileId });
    if (!fileInfo || !fileInfo.result || !fileInfo.result.file_path) return null;

    const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`;
    const filename = `food-tg-${fileId}.jpg`;
    const destPath = path.join(config.UPLOADS_DIR, filename);

    // Asynchronously cache photo to disk
    fetch(fileUrl).then(async (res) => {
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!fs.existsSync(config.UPLOADS_DIR)) {
          fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
        }
        await fs.promises.writeFile(destPath, buffer);
      }
    }).catch(() => {});

    // Return the permanent proxy URL which fetches live from Telegram CDN if disk resets!
    return `/api/reviews/photos/tg/${fileId}`;
  } catch (err) {
    console.error('[Telegram] Failed to process photo:', err.message);
    return null;
  }
}

module.exports = {
  sendTelegramFoodiePrompt,
  handleTelegramWebhook,
  callTelegram,
  setStoredChatId: (id) => { storedChatId = id; }
};
