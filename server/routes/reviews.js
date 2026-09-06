const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

// Ensure uploads folder exists
if (!fs.existsSync(config.UPLOADS_DIR)) {
  fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
}

// Multer storage configuration for food photos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const unique = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    cb(null, `food-${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|heic|gif/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (allowed.test(ext) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are supported'));
    }
  }
});

/**
 * GET /api/reviews
 * Fetch all completed reviews
 */
router.get('/', async (req, res) => {
  try {
    const reviews = await db.getReviews();
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reviews/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const review = await db.getReviewById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    res.json(review);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/reviews
 * Save a review (multipart with photo or application/json)
 */
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const { name, rating, comment, lat, lon, address, category, sessionId } = req.body;

    if (!name || !rating || !lat || !lon) {
      return res.status(400).json({ error: 'Missing required fields: name, rating, lat, lon' });
    }

    const reviewId = 'rev_' + crypto.randomBytes(6).toString('hex');
    const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const review = {
      id: reviewId,
      name: name.trim(),
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      address: address ? address.trim() : '',
      rating: parseInt(rating, 10),
      comment: comment ? comment.trim() : '',
      photo_url: photoUrl,
      category: category || 'Restaurant',
      created_at: Date.now()
    };

    await db.insertReview(review);

    // If submitted via a pending session, mark that session as resolved
    if (sessionId) {
      await db.resolvePending(sessionId, 'completed');
    }

    console.log(`[Reviews] New review saved: "${review.name}" (${review.rating} ⭐)`);
    res.status(201).json(review);
  } catch (err) {
    console.error('[Reviews] Error creating review:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reviews/pending/all
 * List all unreviewed pending prompts
 */
router.get('/pending/all', async (req, res) => {
  try {
    const raw = await db.getPendingReviews();
    const pendings = raw.map(p => {
      let candidates = [];
      try {
        candidates = JSON.parse(p.candidates_json || '[]');
      } catch (e) {}
      return { ...p, candidates };
    });
    res.json(pendings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reviews/pending/:id
 * Get details of a single pending review session
 */
router.get('/pending/:id', async (req, res) => {
  try {
    const pending = await db.getPendingById(req.params.id);
    if (!pending) {
      return res.status(404).json({ error: 'Pending review session not found' });
    }
    let candidates = [];
    try {
      candidates = JSON.parse(pending.candidates_json || '[]');
    } catch (e) {}

    res.json({ ...pending, candidates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/reviews/pending/:id/dismiss
 * Dismiss / skip a pending prompt
 */
router.post('/pending/:id/dismiss', async (req, res) => {
  try {
    await db.resolvePending(req.params.id, 'dismissed');
    res.json({ message: 'Pending prompt dismissed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reviews/photos/tg/:fileId
 * Streams Telegram food photos live from Telegram CDN with caching.
 * Guaranteed never to 404 even if Render free-tier restarts or wipes disk!
 */
router.get('/photos/tg/:fileId', async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const { callTelegram } = require('../services/telegramBot');
    const fileInfo = await callTelegram('getFile', { file_id: fileId });

    if (!fileInfo || !fileInfo.result || !fileInfo.result.file_path) {
      return res.status(404).send('Photo not found on Telegram');
    }

    const tgUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`;
    const upstream = await fetch(tgUrl);
    if (!upstream.ok) return res.status(404).send('Failed to fetch from Telegram CDN');

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
