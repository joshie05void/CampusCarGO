const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../config/db');
const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

router.post('/route', verifyToken, async (req, res) => {
  const { start_lng, start_lat, end_lng, end_lat } = req.body;
  try {
    const response = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      { coordinates: [[start_lng, start_lat], [end_lng, end_lat]] },
      { headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json' } }
    );
    const coordinates = response.data.features[0].geometry.coordinates;
    const distance = response.data.features[0].properties.summary.distance;
    const duration = response.data.features[0].properties.summary.duration;
    res.json({ coordinates, distance_meters: distance, duration_seconds: duration });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', async (req, res) => {
  const { q } = req.query;
  try {
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}, Thiruvananthapuram&format=json&limit=5`,
      { headers: { 'User-Agent': 'CampusCarGO/1.0' } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;