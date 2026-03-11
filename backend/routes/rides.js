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

// Post a ride (driver only)
router.post('/post', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can post rides' });
  const { start_location, end_location, departure_time, available_seats, start_lng, start_lat, end_lng, end_lat } = req.body;
  try {
    const orsResponse = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      { coordinates: [[start_lng, start_lat], [end_lng, end_lat]] },
      { headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json' } }
    );
    const coordinates = orsResponse.data.features[0].geometry.coordinates;
    const linestring = 'LINESTRING(' + coordinates.map(c => c[0] + ' ' + c[1]).join(',') + ')';
    const result = await pool.query(
      'INSERT INTO rides (driver_id, start_location, end_location, departure_time, available_seats, route_polyline) VALUES ($1, $2, $3, $4, $5, ST_GeomFromText($6, 4326)) RETURNING id, driver_id, start_location, end_location, departure_time, available_seats, status',
      [req.user.id, start_location, end_location, departure_time, available_seats, linestring]
    );
    res.json({ message: 'Ride posted successfully', ride: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all active rides
router.get('/available', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT rides.*, users.name as driver_name FROM rides JOIN users ON rides.driver_id = users.id WHERE rides.status = $1',
      ['active']
    );
    res.json({ rides: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Request to join a ride
router.post('/request', verifyToken, async (req, res) => {
  if (req.user.role !== 'passenger') return res.status(403).json({ error: 'Only passengers can request rides' });
  const { ride_id, pickup_location, dropoff_location } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO ride_requests (ride_id, passenger_id, pickup_location, dropoff_location) VALUES ($1, $2, $3, $4) RETURNING *',
      [ride_id, req.user.id, pickup_location, dropoff_location]
    );
    res.json({ message: 'Ride request sent', request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;