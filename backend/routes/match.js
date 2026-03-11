const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const axios = require('axios');

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

// Haversine distance in meters
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Find matching rides for a passenger
router.post('/find', verifyToken, async (req, res) => {
  const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, departure_time } = req.body;

  try {
    // Step 1 - Find rides where passenger is within 500m of route
    const nearbyRides = await pool.query(
      `SELECT rides.*, users.name as driver_name,
        ST_Distance(
          route_polyline::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) as pickup_distance
       FROM rides
       JOIN users ON rides.driver_id = users.id
       WHERE rides.status = 'active'
       AND rides.available_seats > 0
       AND ST_Distance(
         route_polyline::geography,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
       ) < 500`,
      [pickup_lng, pickup_lat]
    );

    if (nearbyRides.rows.length === 0) {
      return res.json({ matches: [], message: 'No nearby rides found' });
    }

    // Step 2 - Score each candidate
    const scored = nearbyRides.rows.map(ride => {
      const pickupDistance = ride.pickup_distance;

      // Time compatibility (within 30 minutes)
      const ridetime = new Date(ride.departure_time).getTime();
      const requested = new Date(departure_time).getTime();
      const timeDiff = Math.abs(ridetime - requested) / 60000;
      const timeScore = timeDiff <= 30 ? 1 - (timeDiff / 30) : 0;

      // Proximity score (closer is better)
      const proximityScore = 1 - (pickupDistance / 500);

      // Seat score
      const seatScore = ride.available_seats > 0 ? 1 : 0;

      // Final score
      const score = (proximityScore * 0.4) + (timeScore * 0.3) + (seatScore * 0.1);

      return {
        ride_id: ride.id,
        driver_name: ride.driver_name,
        start_location: ride.start_location,
        end_location: ride.end_location,
        departure_time: ride.departure_time,
        available_seats: ride.available_seats,
        pickup_distance_meters: Math.round(pickupDistance),
        compatibility_score: Math.round(score * 100),
      };
    });

    // Step 3 - Sort by score
    scored.sort((a, b) => b.compatibility_score - a.compatibility_score);

    res.json({ matches: scored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;