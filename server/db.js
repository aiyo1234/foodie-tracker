const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Ensure data directory exists for local fallback
const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// If TURSO_DATABASE_URL is set, connect to Cloud Turso SQLite (never deletes data!)
// Otherwise fallback to local file SQLite
const dbUrl = process.env.TURSO_DATABASE_URL || config.TURSO_DATABASE_URL || `file:${config.DB_PATH.replace(/\\/g, '/')}`;
const authToken = process.env.TURSO_AUTH_TOKEN || config.TURSO_AUTH_TOKEN || undefined;

const client = createClient({
  url: dbUrl,
  authToken: authToken
});

console.log(`[DB] Connected to: ${dbUrl.startsWith('libsql') ? '☁️ Cloud Turso SQLite (Persistent & Permanent)' : '📁 Local SQLite'}`);

/**
 * Initialize Tables
 */
async function initDb() {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      address TEXT,
      rating INTEGER NOT NULL,
      comment TEXT,
      photo_url TEXT,
      category TEXT,
      created_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS pending_reviews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      candidates_json TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      address TEXT,
      category TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS prompted_places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      name TEXT,
      prompted_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS bot_sessions (
      chat_id TEXT PRIMARY KEY,
      flow TEXT,
      step TEXT,
      session_id TEXT,
      rating INTEGER,
      store_name TEXT,
      lat REAL,
      lon REAL,
      address TEXT,
      pending_json TEXT,
      updated_at INTEGER NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);`,
    `CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_pending_status_created ON pending_reviews(status, created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_prompted_time ON prompted_places(prompted_at);`
  ]);
}

// Auto-run migrations on load
initDb().catch(err => console.error('[DB] Migration error:', err));

module.exports = {
  client,
  initDb,
  getReviews: async () => {
    const rs = await client.execute('SELECT * FROM reviews ORDER BY created_at DESC');
    return rs.rows;
  },
  getReviewById: async (id) => {
    const rs = await client.execute({ sql: 'SELECT * FROM reviews WHERE id = ?', args: [id] });
    return rs.rows[0] || null;
  },
  insertReview: async (review) => {
    return await client.execute({
      sql: `INSERT INTO reviews (id, name, lat, lon, address, rating, comment, photo_url, category, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        review.id,
        review.name,
        review.lat,
        review.lon,
        review.address || '',
        review.rating,
        review.comment || '',
        review.photo_url || null,
        review.category || 'Restaurant',
        review.created_at || Date.now()
      ]
    });
  },
  deleteLatestReview: async () => {
    const rs = await client.execute('SELECT id, name FROM reviews ORDER BY created_at DESC LIMIT 1');
    if (rs.rows.length === 0) return null;
    const item = rs.rows[0];
    await client.execute({ sql: 'DELETE FROM reviews WHERE id = ?', args: [item.id] });
    return item;
  },
  getPendingReviews: async () => {
    const rs = await client.execute("SELECT * FROM pending_reviews WHERE status = 'pending' ORDER BY created_at DESC");
    return rs.rows;
  },
  getPendingById: async (id) => {
    const rs = await client.execute({ sql: 'SELECT * FROM pending_reviews WHERE id = ?', args: [id] });
    return rs.rows[0] || null;
  },
  insertPending: async (pending) => {
    return await client.execute({
      sql: `INSERT INTO pending_reviews (id, name, candidates_json, lat, lon, address, category, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      args: [
        pending.id,
        pending.name,
        JSON.stringify(pending.candidates || []),
        pending.lat,
        pending.lon,
        pending.address || '',
        pending.category || 'Restaurant',
        pending.created_at || Date.now()
      ]
    });
  },
  resolvePending: async (id, status = 'completed') => {
    return await client.execute({ sql: 'UPDATE pending_reviews SET status = ? WHERE id = ?', args: [status, id] });
  },
  recordPrompt: async (lat, lon, name) => {
    const now = Date.now();
    // Auto-prune prompts older than 30 days to avoid table bloat
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    client.execute({ sql: 'DELETE FROM prompted_places WHERE prompted_at < ?', args: [thirtyDaysAgo] }).catch(() => {});

    return await client.execute({
      sql: 'INSERT INTO prompted_places (lat, lon, name, prompted_at) VALUES (?, ?, ?, ?)',
      args: [lat, lon, name || 'Eatery', now]
    });
  },
  getRecentPrompts: async (sinceMs) => {
    const rs = await client.execute({ sql: 'SELECT * FROM prompted_places WHERE prompted_at >= ?', args: [sinceMs] });
    return rs.rows;
  },
  getSetting: async (key) => {
    const rs = await client.execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] });
    return rs.rows[0] ? rs.rows[0].value : null;
  },
  setSetting: async (key, value) => {
    return await client.execute({
      sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      args: [key, String(value)]
    });
  },
  getBotSession: async (chatId) => {
    const rs = await client.execute({
      sql: 'SELECT * FROM bot_sessions WHERE chat_id = ?',
      args: [String(chatId)]
    });
    if (!rs.rows[0]) return null;
    const row = rs.rows[0];
    let pending = null;
    if (row.pending_json) {
      try { pending = JSON.parse(row.pending_json); } catch (e) {}
    }
    return {
      flow: row.flow,
      step: row.step,
      sessionId: row.session_id,
      rating: row.rating !== null ? Number(row.rating) : undefined,
      storeName: row.store_name,
      name: row.store_name,
      lat: row.lat !== null ? Number(row.lat) : undefined,
      lon: row.lon !== null ? Number(row.lon) : undefined,
      address: row.address,
      pending,
      updatedAt: Number(row.updated_at)
    };
  },
  setBotSession: async (chatId, s) => {
    return await client.execute({
      sql: `INSERT OR REPLACE INTO bot_sessions 
            (chat_id, flow, step, session_id, rating, store_name, lat, lon, address, pending_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        String(chatId),
        s.flow || null,
        s.step || null,
        s.sessionId || null,
        s.rating !== undefined ? Number(s.rating) : null,
        s.storeName || s.name || null,
        s.lat !== undefined ? Number(s.lat) : null,
        s.lon !== undefined ? Number(s.lon) : null,
        s.address || null,
        s.pending ? JSON.stringify(s.pending) : null,
        Date.now()
      ]
    });
  },
  deleteBotSession: async (chatId) => {
    return await client.execute({
      sql: 'DELETE FROM bot_sessions WHERE chat_id = ?',
      args: [String(chatId)]
    });
  }
};
