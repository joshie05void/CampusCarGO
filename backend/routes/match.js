/**
 * Match Routes — /api/match
 * ─────────────────────────
 * Thin route handler that delegates to the matching engine v3.0.
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const { findMatches } = require('../matching-engine');
require('dotenv').config();

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

// ═══════════════════════════════════════════════════
//  POST /find — Smart ride matching (v3.0)
// ═══════════════════════════════════════════════════
router.post('/find', verifyToken, async (req, res) => {
  const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, departure_time } = req.body;

  if (!pickup_lat || !pickup_lng || !departure_time) {
    return res.status(400).json({ error: 'pickup_lat, pickup_lng, and departure_time are required.' });
  }

  try {
    const result = await findMatches({
      pickupLat: pickup_lat,
      pickupLng: pickup_lng,
      dropoffLat: dropoff_lat || 8.4682,
      dropoffLng: dropoff_lng || 76.9829,
      departureTime: departure_time,
      userId: req.user.id,
      pool,
    });

    res.json(result);
  } catch (err) {
    console.error('Match error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
