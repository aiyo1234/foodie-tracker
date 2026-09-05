const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

// Ensure data directory exists
const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(config.DB_PATH);

// Enable WAL mode for better concurrency and performance
db.exec('PRAGMA journal_mode = WAL;');

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
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
  );

  CREATE TABLE IF NOT EXISTS pending_reviews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    candidates_json TEXT,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    address TEXT,
    category TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prompted_places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    name TEXT,
    prompted_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
  CREATE INDEX IF NOT EXISTS idx_prompted_time ON prompted_places(prompted_at);
`);

console.log(`[DB] Database initialized at: ${config.DB_PATH}`);

module.exports = {
  db,
  // Helper queries
  getReviews: () => {
    return db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all();
  },
  getReviewById: (id) => {
    return db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  },
  insertReview: (review) => {
    const stmt = db.prepare(`
      INSERT INTO reviews (id, name, lat, lon, address, rating, comment, photo_url, category, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
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
    );
  },
  getPendingReviews: () => {
    return db.prepare("SELECT * FROM pending_reviews WHERE status = 'pending' ORDER BY created_at DESC").all();
  },
  getPendingById: (id) => {
    return db.prepare('SELECT * FROM pending_reviews WHERE id = ?').get(id);
  },
  insertPending: (pending) => {
    const stmt = db.prepare(`
      INSERT INTO pending_reviews (id, name, candidates_json, lat, lon, address, category, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);
    return stmt.run(
      pending.id,
      pending.name,
      JSON.stringify(pending.candidates || []),
      pending.lat,
      pending.lon,
      pending.address || '',
      pending.category || 'Restaurant',
      pending.created_at || Date.now()
    );
  },
  resolvePending: (id, status = 'completed') => {
    return db.prepare('UPDATE pending_reviews SET status = ? WHERE id = ?').run(status, id);
  },
  recordPrompt: (lat, lon, name) => {
    const stmt = db.prepare('INSERT INTO prompted_places (lat, lon, name, prompted_at) VALUES (?, ?, ?, ?)');
    return stmt.run(lat, lon, name || 'Eatery', Date.now());
  },
  getRecentPrompts: (sinceMs) => {
    return db.prepare('SELECT * FROM prompted_places WHERE prompted_at >= ?').all(sinceMs);
  },
  getSetting: (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },
  setSetting: (key, value) => {
    return db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  },
  close: () => {
    try {
      db.close();
    } catch (e) {}
  }
};
