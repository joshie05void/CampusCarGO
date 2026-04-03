/**
 * Platform Statistics — /api/stats
 * ─────────────────────────────────
 * Public endpoint (no auth required).
 * Returns aggregate platform metrics for the login page and dashboard widget.
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// Cache stats for 60 seconds to avoid hammering the DB on every page load
let cachedStats = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000; // 60s

router.get('/', async (req, res) => {
  const now = Date.now();
  if (cachedStats && now - cacheTime < CACHE_TTL) {
    return res.json(cachedStats);
  }

  try {
    const [users, rides, eco, ratings] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total_users FROM users`),
      pool.query(`
        SELECT
          COUNT(*)::int AS total_rides,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_rides,
          COUNT(*) FILTER (WHERE status IN ('active', 'in_progress'))::int AS active_rides
        FROM rides
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(co2_saved_g), 0)::numeric AS total_co2_saved_g,
          COALESCE(SUM(distance_km), 0)::numeric AS total_distance_km
        FROM rides
      `),
      pool.query(`
        SELECT
          ROUND(AVG(stars)::numeric, 1) AS avg_rating,
          COUNT(*)::int AS total_ratings
        FROM ratings
      `),
    ]);

    const stats = {
      total_users: users.rows[0].total_users,
      total_rides: rides.rows[0].total_rides,
      completed_rides: rides.rows[0].completed_rides,
      active_rides: rides.rows[0].active_rides,
      total_co2_saved_g: parseFloat(eco.rows[0].total_co2_saved_g) || 0,
      total_distance_km: parseFloat(eco.rows[0].total_distance_km) || 0,
      trees_equivalent: parseFloat(((parseFloat(eco.rows[0].total_co2_saved_g) || 0) / 25000).toFixed(2)),
      avg_rating: ratings.rows[0].avg_rating ? parseFloat(ratings.rows[0].avg_rating) : null,
      total_ratings: ratings.rows[0].total_ratings,
    };

    cachedStats = stats;
    cacheTime = now;

    res.json(stats);
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
