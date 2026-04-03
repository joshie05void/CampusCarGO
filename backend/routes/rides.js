const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const h3cache = require('../h3cache');
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

// ── POST /post — driver posts a ride ────────────────────────────────────────
router.post('/post', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can post rides' });
  const { start_location, end_location, departure_time, available_seats, start_lat, start_lng, end_lat, end_lng } = req.body;
  if (!start_location || !departure_time || !available_seats || start_lat == null || start_lng == null) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  try {
    // Feature 7: block if driver has active/in_progress ride within 2 hours of new one
    const conflict = await pool.query(
      `SELECT id, departure_time FROM rides
       WHERE driver_id = $1 AND status IN ('active', 'in_progress')
         AND ABS(EXTRACT(EPOCH FROM (departure_time - $2::timestamptz)) / 3600) < 2`,
      [req.user.id, departure_time]
    );
    if (conflict.rows.length > 0) {
      const t = new Date(conflict.rows[0].departure_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      return res.status(400).json({ error: `You already have an active ride at ${t}. Delete or complete it before posting another within 2 hours.` });
    }

    const orsResponse = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      { coordinates: [[start_lng, start_lat], [end_lng, end_lat]] },
      { headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json' } }
    );
    const coordinates = orsResponse.data.features[0].geometry.coordinates;
    const linestring = 'LINESTRING(' + coordinates.map(c => c[0] + ' ' + c[1]).join(',') + ')';
    const result = await pool.query(
      'INSERT INTO rides (driver_id, start_location, end_location, departure_time, available_seats, route_polyline) VALUES ($1, $2, $3, $4, $5, ST_GeomFromText($6, 4326)) RETURNING *',
      [req.user.id, start_location, end_location, departure_time, available_seats, linestring]
    );
    // Index the new ride in the H3 spatial cache
    try {
      h3cache.indexRide(result.rows[0].id, coordinates);
    } catch (h3err) {
      console.error('[H3] Index error on post:', h3err.message);
    }

    res.json({ message: 'Ride posted successfully', ride: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /available — all active rides ───────────────────────────────────────
router.get('/available', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT rides.*, users.name as driver_name FROM rides JOIN users ON rides.driver_id = users.id WHERE rides.status = $1",
      ['active']
    );
    res.json({ rides: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /history — completed ride history (both roles) ───────────────────────
router.get('/history', verifyToken, async (req, res) => {
  try {
    if (req.user.role === 'driver') {
      const result = await pool.query(
        `SELECT
           r.id, r.start_location, r.end_location, r.departure_time, r.status,
           COUNT(rr.id) FILTER (WHERE rr.status = 'accepted') as passenger_count,
           ROUND((SELECT AVG(stars) FROM ratings WHERE ride_id = r.id AND ratee_id = r.driver_id)::numeric, 1) as avg_rating_received,
           (SELECT json_agg(json_build_object('ratee_id', rat.ratee_id, 'ratee_name', u2.name, 'stars', rat.stars))
            FROM ratings rat JOIN users u2 ON u2.id = rat.ratee_id
            WHERE rat.ride_id = r.id AND rat.rater_id = r.driver_id
           ) as ratings_given
         FROM rides r
         LEFT JOIN ride_requests rr ON rr.ride_id = r.id
         WHERE r.driver_id = $1 AND r.status = 'completed'
         GROUP BY r.id
         ORDER BY r.departure_time DESC`,
        [req.user.id]
      );
      res.json({ history: result.rows });
    } else {
      const result = await pool.query(
        `SELECT
           r.id, r.start_location, r.end_location, r.departure_time, r.status,
           u_driver.name as driver_name,
           rr.pickup_location,
           (SELECT stars FROM ratings WHERE ride_id = r.id AND rater_id = $1 AND ratee_id = r.driver_id LIMIT 1) as rating_given,
           (SELECT stars FROM ratings WHERE ride_id = r.id AND rater_id = r.driver_id AND ratee_id = $1 LIMIT 1) as rating_received
         FROM ride_requests rr
         JOIN rides r ON r.id = rr.ride_id
         JOIN users u_driver ON u_driver.id = r.driver_id
         WHERE rr.passenger_id = $1 AND rr.status = 'accepted' AND r.status = 'completed'
         ORDER BY r.departure_time DESC`,
        [req.user.id]
      );
      res.json({ history: result.rows });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics — driver analytics ───────────────────────────────────────
router.get('/analytics', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can view analytics' });
  try {
    const result = await pool.query(
      `SELECT
         COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'completed') as total_rides,
         COUNT(rr.id) FILTER (WHERE rr.status = 'accepted' AND r.status = 'completed') as total_passengers,
         ROUND(AVG(rr.score) FILTER (WHERE rr.status = 'accepted' AND r.status = 'completed')::numeric, 1) as avg_score,
         ROUND((SELECT AVG(stars) FROM ratings WHERE ratee_id = $1)::numeric, 1) as avg_rating,
         MAX(u.total_co2_saved) as total_co2_saved,
         MAX(u.total_distance_km) as total_distance_km
       FROM rides r
       LEFT JOIN ride_requests rr ON rr.ride_id = r.id
       JOIN users u ON u.id = r.driver_id
       WHERE r.driver_id = $1`,
      [req.user.id]
    );
    res.json({ analytics: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /myrides — driver's posted rides ────────────────────────────────────
router.get('/myrides', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can view their rides' });
  try {
    const result = await pool.query(
      `SELECT * FROM rides WHERE driver_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ rides: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /mystatus — passenger's request statuses ─────────────────────────────
router.get('/mystatus', verifyToken, async (req, res) => {
  if (req.user.role !== 'passenger') return res.status(403).json({ error: 'Only passengers can check status' });
  try {
    const result = await pool.query(
      `SELECT
         rr.*,
         r.start_location, r.departure_time, r.status as ride_status,
         u.name as driver_name,
         ROUND((SELECT AVG(stars) FROM ratings WHERE ratee_id = r.driver_id)::numeric, 1) as driver_avg_rating
       FROM ride_requests rr
       JOIN rides r ON rr.ride_id = r.id
       JOIN users u ON r.driver_id = u.id
       WHERE rr.passenger_id = $1
       ORDER BY rr.created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /requests — driver's pending incoming requests ──────────────────────
router.get('/requests', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can view requests' });
  try {
    const result = await pool.query(
      `SELECT ride_requests.*, users.name as passenger_name, rides.start_location, rides.departure_time
       FROM ride_requests
       JOIN users ON ride_requests.passenger_id = users.id
       JOIN rides ON ride_requests.ride_id = rides.id
       WHERE rides.driver_id = $1 AND ride_requests.status = 'pending'
       ORDER BY ride_requests.created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /pending-ratings — rides needing a rating from current user ──────────
router.get('/pending-ratings', verifyToken, async (req, res) => {
  try {
    let rows = [];
    if (req.user.role === 'driver') {
      const result = await pool.query(
        `SELECT DISTINCT rr.passenger_id as ratee_id, u.name as ratee_name, r.id as ride_id, r.start_location
         FROM rides r
         JOIN ride_requests rr ON rr.ride_id = r.id AND rr.status = 'accepted'
         JOIN users u ON u.id = rr.passenger_id
         WHERE r.driver_id = $1 AND r.status = 'completed'
           AND NOT EXISTS (
             SELECT 1 FROM ratings
             WHERE ride_id = r.id AND rater_id = $1 AND ratee_id = rr.passenger_id
           )`,
        [req.user.id]
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT DISTINCT r.driver_id as ratee_id, u.name as ratee_name, r.id as ride_id, r.start_location
         FROM rides r
         JOIN ride_requests rr ON rr.ride_id = r.id AND rr.passenger_id = $1 AND rr.status = 'accepted'
         JOIN users u ON u.id = r.driver_id
         WHERE r.status = 'completed'
           AND NOT EXISTS (
             SELECT 1 FROM ratings
             WHERE ride_id = r.id AND rater_id = $1 AND ratee_id = r.driver_id
           )`,
        [req.user.id]
      );
      rows = result.rows;
    }
    res.json({ pending_ratings: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /request — passenger requests a ride ───────────────────────────────
router.post('/request', verifyToken, async (req, res) => {
  if (req.user.role !== 'passenger') return res.status(403).json({ error: 'Only passengers can request rides' });
  const { ride_id, pickup_location, dropoff_location, pickup_lat, pickup_lng, score } = req.body;
  if (!ride_id || !pickup_location) return res.status(400).json({ error: 'ride_id and pickup_location are required.' });
  try {
    const ride = await pool.query(
      `SELECT id, available_seats, status, driver_id FROM rides WHERE id = $1`,
      [ride_id]
    );
    if (ride.rows.length === 0) return res.status(404).json({ error: 'Ride not found.' });
    if (ride.rows[0].status !== 'active') return res.status(400).json({ error: 'This ride is no longer active.' });
    if (ride.rows[0].available_seats <= 0) return res.status(400).json({ error: 'No seats available on this ride.' });

    // Feature 7: block if passenger already has any pending or accepted request FOR AN ACTIVE RIDE
    const activeReq = await pool.query(
      `SELECT rr.id FROM ride_requests rr
       JOIN rides r ON rr.ride_id = r.id
       WHERE rr.passenger_id = $1 AND rr.status IN ('pending', 'accepted')
       AND r.status IN ('active', 'in_progress')`,
      [req.user.id]
    );
    if (activeReq.rows.length > 0) {
      return res.status(400).json({ error: 'You already have an active ride request. Cancel it before requesting a new one.' });
    }

    const result = await pool.query(
      `INSERT INTO ride_requests (ride_id, passenger_id, pickup_location, dropoff_location, pickup_lat, pickup_lng, score)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [ride_id, req.user.id, pickup_location, dropoff_location, pickup_lat || null, pickup_lng || null, score || null]
    );

    // Feature 6: notify driver
    await pool.query(
      `INSERT INTO notifications (user_id, message) VALUES ($1, $2)`,
      [ride.rows[0].driver_id, `New request: a passenger wants to join your ride from ${pickup_location}.`]
    );

    res.json({ message: 'Ride request sent successfully', request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /respond — driver accepts or rejects a request ─────────────────────
router.post('/respond', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can respond to requests' });
  const { request_id, action } = req.body;
  if (!['accepted', 'rejected'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    const check = await pool.query(
      `SELECT rr.id, rr.passenger_id, rr.pickup_location, rr.ride_id FROM ride_requests rr
       JOIN rides r ON rr.ride_id = r.id
       WHERE rr.id = $1 AND r.driver_id = $2`,
      [request_id, req.user.id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Request not found.' });

    await pool.query('UPDATE ride_requests SET status = $1 WHERE id = $2', [action, request_id]);

    if (action === 'accepted') {
      await pool.query(
        `UPDATE rides SET available_seats = available_seats - 1
         WHERE id = $1 AND available_seats > 0`,
        [check.rows[0].ride_id]
      );
      await pool.query(
        `INSERT INTO notifications (user_id, message) VALUES ($1, $2)`,
        [check.rows[0].passenger_id, 'Your ride request has been accepted! Check your dashboard for details.']
      );
    } else {
      await pool.query(
        `INSERT INTO notifications (user_id, message) VALUES ($1, $2)`,
        [check.rows[0].passenger_id, 'Your ride request was not accepted. You can search for other rides.']
      );
    }

    res.json({ message: `Request ${action} successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /start/:id — driver starts a ride ───────────────────────────────────
router.post('/start/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can start rides' });
  try {
    const check = await pool.query(`SELECT id FROM rides WHERE id = $1 AND driver_id = $2`, [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Ride not found.' });
    await pool.query(`UPDATE rides SET status = 'in_progress' WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Ride started.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /complete/:id — driver completes a ride ─────────────────────────────
router.post('/complete/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can complete rides' });
  try {
    const check = await pool.query(`SELECT id, start_location FROM rides WHERE id = $1 AND driver_id = $2`, [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Ride not found.' });

    await pool.query(`UPDATE rides SET status = 'completed' WHERE id = $1`, [req.params.id]);
    h3cache.removeRide(parseInt(req.params.id));

    const passengerRows = await pool.query(
      `SELECT passenger_id FROM ride_requests WHERE ride_id = $1 AND status = 'accepted'`,
      [req.params.id]
    );

    // Calculate environmental impact
    const rideInfo = await pool.query(
      `SELECT ST_Length(route_polyline::geography) / 1000.0 as dist_km FROM rides WHERE id = $1`,
      [req.params.id]
    );
    const distKm = parseFloat(rideInfo.rows[0]?.dist_km) || 0;
    const passengerCount = passengerRows.rows.length;
    const co2SavedTotal = (distKm * 120 * passengerCount);

    // Cache impact on the ride record
    await pool.query(
      `UPDATE rides SET distance_km = $1, co2_saved_g = $2 WHERE id = $3`,
      [distKm, co2SavedTotal, req.params.id]
    );

    // Update driver's lifetime stats
    await pool.query(
      `UPDATE users SET total_distance_km = total_distance_km + $1, total_co2_saved = total_co2_saved + $2 WHERE id = $3`,
      [distKm, co2SavedTotal, req.user.id]
    );

    // Notify and update stats for each passenger
    for (const p of passengerRows.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, message) VALUES ($1, $2)`,
        [p.passenger_id, `Your ride from ${check.rows[0].start_location} is complete. You saved ${(distKm * 120).toFixed(0)}g of CO2! Please rate your driver.`]
      );
      await pool.query(
        `UPDATE users SET total_distance_km = total_distance_km + $1, total_co2_saved = total_co2_saved + $2 WHERE id = $3`,
        [distKm, distKm * 120, p.passenger_id]
      );
    }

    await pool.query(
      `INSERT INTO notifications (user_id, message) VALUES ($1, $2)`,
      [req.user.id, `Ride completed! You and your passengers saved ${co2SavedTotal.toFixed(0)}g of CO2. Please rate your passengers.`]
    );

    res.json({ message: 'Ride completed.', co2_saved_g: co2SavedTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cancel-request/:id — passenger cancels a request ──────────────────
router.post('/cancel-request/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'passenger') return res.status(403).json({ error: 'Only passengers can cancel requests' });
  try {
    const check = await pool.query(
      `SELECT rr.id, rr.ride_id, rr.status, r.driver_id FROM ride_requests rr
       JOIN rides r ON r.id = rr.ride_id
       WHERE rr.id = $1 AND rr.passenger_id = $2 AND rr.status IN ('pending', 'accepted')`,
      [req.params.id, req.user.id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Request not found.' });

    const wasAccepted = check.rows[0].status === 'accepted';
    await pool.query(`UPDATE ride_requests SET status = 'cancelled' WHERE id = $1`, [req.params.id]);

    if (wasAccepted) {
      await pool.query(`UPDATE rides SET available_seats = available_seats + 1 WHERE id = $1`, [check.rows[0].ride_id]);
    }

    // Feature 6: notify driver
    await pool.query(
      `INSERT INTO notifications (user_id, message) VALUES ($1, $2)`,
      [check.rows[0].driver_id, 'A passenger has cancelled their ride request.']
    );

    res.json({ message: 'Request cancelled.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /rate — submit a star rating ────────────────────────────────────────
router.post('/rate', verifyToken, async (req, res) => {
  const { ride_id, ratee_id, stars } = req.body;
  if (!ride_id || !ratee_id || !stars) return res.status(400).json({ error: 'ride_id, ratee_id, and stars are required.' });
  if (stars < 1 || stars > 5) return res.status(400).json({ error: 'Stars must be between 1 and 5.' });
  try {
    const ride = await pool.query(`SELECT status FROM rides WHERE id = $1`, [ride_id]);
    if (ride.rows.length === 0) return res.status(404).json({ error: 'Ride not found.' });
    if (ride.rows[0].status !== 'completed') return res.status(400).json({ error: 'Ride is not completed yet.' });
    const existing = await pool.query(
      `SELECT id FROM ratings WHERE ride_id = $1 AND rater_id = $2 AND ratee_id = $3`,
      [ride_id, req.user.id, ratee_id]
    );
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Already rated.' });
    await pool.query(
      `INSERT INTO ratings (ride_id, rater_id, ratee_id, stars) VALUES ($1, $2, $3, $4)`,
      [ride_id, req.user.id, ratee_id, stars]
    );
    res.json({ message: 'Rating submitted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /confirmed-passengers/:id — accepted passengers for a ride (driver) ──
router.get('/confirmed-passengers/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can view confirmed passengers' });
  try {
    const result = await pool.query(
      `SELECT
         rr.id, rr.passenger_id, rr.pickup_location, rr.pickup_lat, rr.pickup_lng,
         u.name as passenger_name,
         CASE
           WHEN rr.pickup_lat IS NOT NULL AND rr.pickup_lng IS NOT NULL THEN
             ST_LineLocatePoint(r.route_polyline, ST_SetSRID(ST_MakePoint(rr.pickup_lng, rr.pickup_lat), 4326))
           ELSE NULL
         END as route_fraction,
         CASE
           WHEN rr.pickup_lat IS NOT NULL AND rr.pickup_lng IS NOT NULL THEN
             ROUND(ST_Distance(
               r.route_polyline::geography,
               ST_SetSRID(ST_MakePoint(rr.pickup_lng, rr.pickup_lat), 4326)::geography
             )::numeric, 0)
           ELSE NULL
         END as pickup_distance_m
       FROM ride_requests rr
       JOIN users u ON u.id = rr.passenger_id
       JOIN rides r ON r.id = rr.ride_id
       WHERE rr.ride_id = $1 AND rr.status = 'accepted'
       ORDER BY route_fraction ASC NULLS LAST`,
      [req.params.id]
    );
    res.json({ passengers: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /delete/:id — driver deletes a ride ───────────────────────────────
router.delete('/delete/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can delete rides' });
  try {
    const check = await pool.query(
      `SELECT id FROM rides WHERE id = $1 AND driver_id = $2`,
      [req.params.id, req.user.id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Ride not found or you do not own this ride.' });
    await pool.query(`DELETE FROM ride_requests WHERE ride_id = $1`, [req.params.id]);
    await pool.query(`DELETE FROM rides WHERE id = $1`, [req.params.id]);
    // Remove from H3 spatial cache
    h3cache.removeRide(parseInt(req.params.id));
    res.json({ message: 'Ride deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/polyline — route polyline for preview map ──────────────────────
router.get('/:id/polyline', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ST_AsGeoJSON(route_polyline) as geojson FROM rides WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0 || !result.rows[0].geojson) {
      return res.status(404).json({ error: 'Ride not found.' });
    }
    const geojson = JSON.parse(result.rows[0].geojson);
    res.json({ coordinates: geojson.coordinates }); // [lng, lat] pairs
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /request/:id — passenger deletes their own ride request ───────────
router.delete('/request/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'passenger') return res.status(403).json({ error: 'Only passengers can delete requests' });
  try {
    const check = await pool.query(
      `SELECT rr.id, rr.status, r.status as ride_status FROM ride_requests rr
       JOIN rides r ON r.id = rr.ride_id
       WHERE rr.id = $1 AND rr.passenger_id = $2`,
      [req.params.id, req.user.id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Request not found.' });
    if (check.rows[0].status === 'accepted' && ['active', 'in_progress'].includes(check.rows[0].ride_status)) {
      return res.status(400).json({ error: 'Cannot delete an active accepted request. Cancel it instead.' });
    }
    await pool.query(`DELETE FROM ride_requests WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Request deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
