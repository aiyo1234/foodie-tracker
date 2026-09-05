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
 */
async function sendTelegramFoodiePrompt({ placeName, sessionId, lat, lon, category }) {
  if (!storedChatId) {
    storedChatId = db.getSetting('telegram_chat_id');
  }

  if (!config.TELEGRAM_BOT_TOKEN || !storedChatId) {
    console.warn('[Telegram] Cannot send alert: BOT_TOKEN or CHAT_ID not configured yet. (Send /start to @daweidaiii_bot)');
    return false;
  }

  const message = `🍽️ *Foodie Alert: Are you at ${escapeMarkdown(placeName)}?*\n\nYou've been at this ${category.toLowerCase()} for a few minutes. Tap a rating below:`;

  const inlineKeyboard = [
    [
      { text: '⭐ 1', callback_data: `rate:1:${sessionId}` },
      { text: '⭐ 2', callback_data: `rate:2:${sessionId}` },
      { text: '⭐ 3', callback_data: `rate:3:${sessionId}` },
      { text: '⭐ 4', callback_data: `rate:4:${sessionId}` },
      { text: '⭐ 5', callback_data: `rate:5:${sessionId}` }
    ],
    [
      { text: '❌ Not an eatery / Ignore', callback_data: `dismiss:${sessionId}` }
    ]
  ];

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
  // 1. Handle Callback Query (User tapped a Star Rating button)
  if (body.callback_query) {
    const query = body.callback_query;
    const data = query.data || '';
    const chatId = query.message.chat.id;
    storedChatId = chatId;

    await callTelegram('answerCallbackQuery', { callback_query_id: query.id });

    if (data.startsWith('rate:')) {
      const parts = data.split(':');
      const rating = parseInt(parts[1], 10);
      const sessionId = parts[2];

      const pending = db.getPendingById(sessionId);
      const storeName = pending ? pending.name : 'this food stall';

      activeSessions.set(chatId, {
        step: 'awaiting_comment',
        rating,
        sessionId,
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

    if (data.startsWith('dismiss:')) {
      const sessionId = data.split(':')[1];
      db.resolvePending(sessionId, 'dismissed');
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
    db.setSetting('telegram_chat_id', chatId);
    const text = (msg.text || '').trim();

    // Command: /start
    if (text === '/start') {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `👋 *Welcome to your Foodie Tracker Bot!*\n\nI will automatically message you here when you visit a food stall so you can rate it with 1 tap.\n\nAll your ratings automatically sync directly to your *Google Maps* list!`,
        parse_mode: 'Markdown'
      });
      return;
    }

    // Command: /list (View recent reviews)
    if (text === '/list') {
      const reviews = db.getReviews().slice(0, 5);
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
        name: pending ? pending.name : 'Local Food Spot',
        lat: pending ? pending.lat : 0,
        lon: pending ? pending.lon : 0,
        address: pending ? pending.address : '',
        rating: active.rating,
        comment: comment || 'Rated via Telegram',
        photo_url: photoUrl,
        category: pending ? pending.category : 'Restaurant',
        created_at: Date.now()
      };

      db.insertReview(review);
      if (active.sessionId) {
        db.resolvePending(active.sessionId, 'completed');
      }

      activeSessions.delete(chatId);

      const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${review.lat},${review.lon}`;

      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `✅ *Saved to your Google Maps Foodie List!*\n\n📍 *${escapeMarkdown(review.name)}*\nRating: ${'⭐'.repeat(review.rating)}\nComment: "${escapeMarkdown(review.comment)}"\n\n🗺️ [View on Google Maps](${gmapsUrl})`,
        parse_mode: 'Markdown'
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
