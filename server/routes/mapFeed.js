const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/map.kml
 * Direct KML layer export for Google Maps / Google Earth
 */
router.get('/map.kml', (req, res) => {
  try {
    const reviews = db.getReviews();

    let placemarks = '';
    reviews.forEach(r => {
      const stars = '⭐'.repeat(r.rating);
      placemarks += `
    <Placemark>
      <name><![CDATA[${r.name} (${stars})]]></name>
      <description><![CDATA[
        <p><b>Rating:</b> ${stars} (${r.rating}/5)</p>
        <p><b>Notes:</b> ${r.comment || 'No notes'}</p>
        <p><b>Address:</b> ${r.address || 'N/A'}</p>
        <p><b>Date:</b> ${new Date(r.created_at).toLocaleDateString()}</p>
      ]]></description>
      <Point>
        <coordinates>${r.lon},${r.lat},0</coordinates>
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

    res.header('Content-Type', 'application/vnd.google-earth.kml+xml');
    res.attachment('my-foodie-list.kml');
    res.send(kml);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/**
 * GET /api/map.csv
 * 1-Click CSV Import for Google My Maps
 */
router.get('/map.csv', (req, res) => {
  try {
    const reviews = db.getReviews();

    let csv = 'Name,Rating,Comment,Address,Latitude,Longitude,Date\n';
    reviews.forEach(r => {
      const escape = (str) => `"${(str || '').replace(/"/g, '""')}"`;
      const date = new Date(r.created_at).toLocaleDateString();
      csv += `${escape(r.name)},${r.rating},${escape(r.comment)},${escape(r.address)},${r.lat},${r.lon},${date}\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('foodie-list.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/**
 * GET /api/map.geojson
 * GeoJSON export
 */
router.get('/map.geojson', (req, res) => {
  try {
    const reviews = db.getReviews();
    const geojson = {
      type: 'FeatureCollection',
      features: reviews.map(r => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [r.lon, r.lat]
        },
        properties: {
          name: r.name,
          rating: r.rating,
          comment: r.comment,
          address: r.address,
          photo_url: r.photo_url,
          date: new Date(r.created_at).toISOString()
        }
      }))
    };
    res.json(geojson);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
