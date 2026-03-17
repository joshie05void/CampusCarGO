const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const axios = require('axios');
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

// Post a ride (driver only)
router.post('/post', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can post rides' });
  const { start_location, end_location, departure_time, available_seats, start_lat, start_lng, end_lat, end_lng } = req.body;
  try {
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
    res.json({ message: 'Ride posted successfully', ride: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all active rides
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

// Request to join a ride (passenger only)
router.post('/request', verifyToken, async (req, res) => {
  if (req.user.role !== 'passenger') return res.status(403).json({ error: 'Only passengers can request rides' });
  const { ride_id, pickup_location, dropoff_location } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO ride_requests (ride_id, passenger_id, pickup_location, dropoff_location) VALUES ($1, $2, $3, $4) RETURNING *',
      [ride_id, req.user.id, pickup_location, dropoff_location]
    );
    res.json({ message: 'Ride request sent successfully', request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all requests for the driver's rides
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

// Accept or reject a request (driver only)
router.post('/respond', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can respond to requests' });
  const { request_id, action } = req.body; // action = 'accepted' or 'rejected'
  if (!['accepted', 'rejected'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    await pool.query(
      'UPDATE ride_requests SET status = $1 WHERE id = $2',
      [action, request_id]
    );
    // If accepted, reduce available seats
    if (action === 'accepted') {
      await pool.query(
        `UPDATE rides SET available_seats = available_seats - 1
         WHERE id = (SELECT ride_id FROM ride_requests WHERE id = $1)
         AND available_seats > 0`,
        [request_id]
      );
    }
    res.json({ message: `Request ${action} successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get request status for passenger
router.get('/mystatus', verifyToken, async (req, res) => {
  if (req.user.role !== 'passenger') return res.status(403).json({ error: 'Only passengers can check status' });
  try {
    const result = await pool.query(
      `SELECT ride_requests.*, rides.start_location, rides.departure_time, users.name as driver_name
       FROM ride_requests
       JOIN rides ON ride_requests.ride_id = rides.id
       JOIN users ON rides.driver_id = users.id
       WHERE ride_requests.passenger_id = $1
       ORDER BY ride_requests.created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Get all rides posted by the driver
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

// Delete a ride (driver only)
router.delete('/delete/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can delete rides' });
  try {
    await pool.query(
      `DELETE FROM rides WHERE id = $1 AND driver_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Ride deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;