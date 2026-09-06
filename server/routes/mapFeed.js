const express = require('express');
const router = express.Router();
const db = require('../db');

function escapeCData(str) {
  if (!str) return '';
  // Prevent CDATA termination injection and strip XML 1.0 control characters
  return String(str)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/]]>/g, ']]]]><![CDATA[>');
}

function escapeCsv(str) {
  if (str == null) return '""';
  let val = String(str).replace(/"/g, '""');
  // Prevent CSV Formula Injection
  if (/^[=+@-]$/.test(val[0])) {
    val = "'" + val;
  }
  return `"${val}"`;
}

/**
 * GET /api/map.kml
 * Direct KML layer export for Google Maps / Google Earth
 */
router.get('/map.kml', async (req, res) => {
  try {
    const reviews = await db.getReviews();

    let placemarks = '';
    reviews.forEach(r => {
      const rating = Math.max(1, Math.min(5, Number(r.rating) || 5));
      const stars = '⭐'.repeat(rating);
      const safeName = escapeCData(r.name);
      const safeComment = escapeCData(r.comment || 'No notes');
      const safeAddress = escapeCData(r.address || 'N/A');
      const date = new Date(r.created_at).toISOString().split('T')[0];

      placemarks += `
    <Placemark>
      <name><![CDATA[${safeName} (${stars})]]></name>
      <description><![CDATA[
        <p><b>Rating:</b> ${stars} (${rating}/5)</p>
        <p><b>Notes:</b> ${safeComment}</p>
        <p><b>Address:</b> ${safeAddress}</p>
        <p><b>Date:</b> ${date}</p>
      ]]></description>
      <Point>
        <coordinates>${Number(r.lon)},${Number(r.lat)},0</coordinates>
      </Point>
    </Placemark>`;
    });

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>My Foodie List</name>
    <description>Automatically tracked foodie places</description>
    ${placemarks}
  </Document>
</kml>`;

    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.attachment('my-foodie-list.kml');
    res.send(kml);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/**
 * GET /api/map.csv
 * 1-Click CSV Import for Google My Maps (With UTF-8 BOM for Excel CJK support)
 */
router.get('/map.csv', async (req, res) => {
  try {
    const reviews = await db.getReviews();

    // Prepend UTF-8 BOM (\uFEFF) for Excel compatibility with CJK and emojis
    let csv = '\uFEFFName,Rating,Comment,Address,Latitude,Longitude,Date\n';
    reviews.forEach(r => {
      const date = new Date(r.created_at).toISOString().split('T')[0];
      csv += `${escapeCsv(r.name)},${r.rating},${escapeCsv(r.comment)},${escapeCsv(r.address)},${r.lat},${r.lon},${date}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.attachment('foodie-list.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/**
 * GET /api/map.geojson
 * GeoJSON RFC 7946 export with coordinate bounds check
 */
router.get('/map.geojson', async (req, res) => {
  try {
    const reviews = await db.getReviews();
    const validFeatures = reviews
      .filter(r => {
        const lat = Number(r.lat);
        const lon = Number(r.lon);
        return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
      })
      .map(r => ({
        type: 'Feature',
        id: r.id,
        geometry: {
          type: 'Point',
          coordinates: [Number(r.lon), Number(r.lat)]
        },
        properties: {
          name: r.name,
          rating: Number(r.rating),
          comment: r.comment || '',
          address: r.address || '',
          photo_url: r.photo_url,
          date: new Date(r.created_at).toISOString()
        }
      }));

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({
      type: 'FeatureCollection',
      features: validFeatures
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
