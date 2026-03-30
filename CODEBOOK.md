# CampusCarGO — Complete Codebase

Generated: 2026-03-30

---

## backend/server.js

```javascript
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
const rideRoutes = require('./routes/rides');
app.use('/api/rides', rideRoutes);
const mapRoutes = require('./routes/maps');
app.use('/api/maps', mapRoutes);
const matchRoutes = require('./routes/match');
app.use('/api/match', matchRoutes);

app.get('/', (req, res) => {
  res.send('CampusCarGO backend is running');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
```

---

## backend/config/db.js

```javascript
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

module.exports = pool;
```

---

## backend/routes/auth.js

```javascript
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

router.post('/register', async (req, res) => {
  const { name, reg_number, password, role } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query('INSERT INTO users (name, reg_number, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *', [name, reg_number, hashedPassword, role]);
    res.json({ message: 'User registered successfully', user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { reg_number, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE reg_number = $1', [reg_number]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'User not found' });
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login successful', token, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

---

## backend/routes/rides.js

```javascript
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
  if (!start_location || !departure_time || !available_seats || start_lat == null || start_lng == null) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
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
  if (!ride_id || !pickup_location) return res.status(400).json({ error: 'ride_id and pickup_location are required.' });
  try {
    // Check ride exists and has seats
    const ride = await pool.query(
      `SELECT id, available_seats, status FROM rides WHERE id = $1`,
      [ride_id]
    );
    if (ride.rows.length === 0) {
      return res.status(404).json({ error: 'Ride not found.' });
    }
    if (ride.rows[0].status !== 'active') {
      return res.status(400).json({ error: 'This ride is no longer active.' });
    }
    if (ride.rows[0].available_seats <= 0) {
      return res.status(400).json({ error: 'No seats available on this ride.' });
    }

    // Check for duplicate request
    const existing = await pool.query(
      `SELECT id FROM ride_requests WHERE ride_id = $1 AND passenger_id = $2 AND status != 'rejected'`,
      [ride_id, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You have already requested this ride.' });
    }

    const result = await pool.query(
      'INSERT INTO ride_requests (ride_id, passenger_id, pickup_location, dropoff_location) VALUES ($1, $2, $3, $4) RETURNING *',
      [ride_id, req.user.id, pickup_location, dropoff_location]
    );
    res.json({ message: 'Ride request sent successfully', request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all pending requests for the driver's rides
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
  const { request_id, action } = req.body;
  if (!['accepted', 'rejected'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    // Verify the request belongs to one of this driver's rides
    const check = await pool.query(
      `SELECT rr.id FROM ride_requests rr
       JOIN rides r ON rr.ride_id = r.id
       WHERE rr.id = $1 AND r.driver_id = $2`,
      [request_id, req.user.id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found.' });
    }

    await pool.query('UPDATE ride_requests SET status = $1 WHERE id = $2', [action, request_id]);

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
    // Verify ownership before deleting
    const check = await pool.query(
      `SELECT id FROM rides WHERE id = $1 AND driver_id = $2`,
      [req.params.id, req.user.id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Ride not found or you do not own this ride.' });
    }
    // Delete associated requests first to satisfy FK constraint
    await pool.query(`DELETE FROM ride_requests WHERE ride_id = $1`, [req.params.id]);
    await pool.query(`DELETE FROM rides WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Ride deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

---

## backend/routes/maps.js

```javascript
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
```

---

## backend/routes/match.js

```javascript
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

// ═══════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleDiff(a, b) {
  let diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Sigmoid time score — flat near 0 min, steep drop around 30 min
function sigmoidTimeScore(diffMinutes) {
  return 1 / (1 + Math.exp(0.15 * (diffMinutes - 30)));
}

// Exponential proximity decay — no hard cutoff, just penalises distance smoothly.
// Half-life at ~3 km (score = 0.5 at 3 km, ~0.14 at 10 km, ~0.02 at 20 km).
function proximityScore(distanceMeters) {
  return Math.exp(-distanceMeters / 4330);
}

// Call ORS for a multi-waypoint route and return total distance in meters
async function getORSRouteDistance(coordinates) {
  try {
    const response = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      { coordinates },
      {
        headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json' },
        timeout: 8000
      }
    );
    return response.data.features[0].properties.summary.distance;
  } catch (err) {
    return null;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


// ═══════════════════════════════════════════════
//  SCORING WEIGHTS
// ═══════════════════════════════════════════════
const WEIGHTS = {
  detour:    0.40,
  position:  0.25,
  time:      0.20,
  proximity: 0.15
};

const SCT = { lat: 8.5241, lng: 76.9366 };


// ═══════════════════════════════════════════════
//  POST /find — Smart ride matching
// ═══════════════════════════════════════════════
router.post('/find', verifyToken, async (req, res) => {
  const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, departure_time } = req.body;

  if (!pickup_lat || !pickup_lng || !departure_time) {
    return res.status(400).json({ error: 'pickup_lat, pickup_lng, and departure_time are required.' });
  }

  try {
    // ──────────────────────────────────────────
    // STEP 1 — Candidate fetch (all active rides, no distance filter)
    // ──────────────────────────────────────────
    const candidateQuery = await pool.query(
      `SELECT
         rides.*,
         users.name AS driver_name,
         ST_Distance(
           route_polyline::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         ) AS pickup_distance,
         ST_LineLocatePoint(
           route_polyline,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)
         ) AS route_fraction,
         ST_X(ST_ClosestPoint(route_polyline, ST_SetSRID(ST_MakePoint($1, $2), 4326))) AS closest_lng,
         ST_Y(ST_ClosestPoint(route_polyline, ST_SetSRID(ST_MakePoint($1, $2), 4326))) AS closest_lat,
         ST_Length(route_polyline::geography) AS route_length_m,
         ST_X(ST_StartPoint(route_polyline)) AS start_lng,
         ST_Y(ST_StartPoint(route_polyline)) AS start_lat,
         ST_X(ST_EndPoint(route_polyline)) AS end_lng,
         ST_Y(ST_EndPoint(route_polyline)) AS end_lat
       FROM rides
       JOIN users ON rides.driver_id = users.id
       WHERE rides.status = 'active'
         AND rides.available_seats > 0
         AND rides.driver_id != $3
       ORDER BY pickup_distance ASC
       LIMIT 20`,
      [pickup_lng, pickup_lat, req.user.id]
    );

    if (candidateQuery.rows.length === 0) {
      return res.json({
        matches: [],
        total_candidates: 0,
        message: 'No drivers are currently active. Check back later.'
      });
    }

    // ──────────────────────────────────────────
    // STEP 2 — Pre-filter: destination & direction
    // ──────────────────────────────────────────
    let candidates = candidateQuery.rows.filter(ride => {
      const endToSCT = haversine(
        parseFloat(ride.end_lat), parseFloat(ride.end_lng),
        SCT.lat, SCT.lng
      );
      if (endToSCT > 2000) return false;

      const rideBearing = bearing(
        parseFloat(ride.start_lat), parseFloat(ride.start_lng),
        parseFloat(ride.end_lat), parseFloat(ride.end_lng)
      );
      const passengerBearing = bearing(
        pickup_lat, pickup_lng,
        dropoff_lat || SCT.lat, dropoff_lng || SCT.lng
      );
      if (angleDiff(rideBearing, passengerBearing) > 90) return false;

      return true;
    });

    if (candidates.length === 0) {
      return res.json({
        matches: [],
        total_candidates: candidateQuery.rows.length,
        message: 'Drivers are active but none are heading to SCT from your direction right now.'
      });
    }

    // Top 10 by proximity for ORS calls
    candidates = candidates.slice(0, 10);

    // ──────────────────────────────────────────
    // STEP 3 — Multi-factor scoring
    // ──────────────────────────────────────────
    const scoredResults = [];

    for (const ride of candidates) {
      const confidenceFactors = [];
      const pickupDist = parseFloat(ride.pickup_distance);
      const routeFraction = parseFloat(ride.route_fraction);
      const routeLength = parseFloat(ride.route_length_m);

      // ── FACTOR 1: Detour Cost (40%) ──────────
      let detourScore = null;
      let detourExtraMeters = null;
      let detourPercent = null;

      try {
        const startCoord  = [parseFloat(ride.start_lng), parseFloat(ride.start_lat)];
        const endCoord    = [parseFloat(ride.end_lng),   parseFloat(ride.end_lat)];
        const pickupCoord = [pickup_lng, pickup_lat];

        const detourDistance = await getORSRouteDistance([startCoord, pickupCoord, endCoord]);

        if (detourDistance !== null && routeLength > 0) {
          const extraDistance = Math.max(0, detourDistance - routeLength);
          detourExtraMeters = Math.round(extraDistance);
          const detourRatio = extraDistance / routeLength;
          detourPercent = Math.round(detourRatio * 100);
          detourScore = Math.max(0, Math.min(1, 1 - detourRatio * 5));
          confidenceFactors.push('detour');
        }

        await sleep(250);
      } catch (err) { /* handled by fallback below */ }

      if (detourScore === null) {
        const estimatedDetour = pickupDist * 2;
        const estimatedRatio = routeLength > 0 ? estimatedDetour / routeLength : 1;
        detourScore = Math.max(0, Math.min(1, 1 - estimatedRatio * 5));
        detourExtraMeters = Math.round(estimatedDetour);
        detourPercent = Math.round(estimatedRatio * 100);
      }

      // ── FACTOR 2: Pickup Position on Route (25%) ──
      let posScore;
      let positionLabel;

      if (isNaN(routeFraction)) {
        posScore = 0.5;
        positionLabel = 'Unknown';
      } else if (routeFraction < 0.3) {
        posScore = 1.0;
        positionLabel = 'Early on route';
        confidenceFactors.push('position');
      } else if (routeFraction < 0.6) {
        posScore = 0.85;
        positionLabel = 'Mid route';
        confidenceFactors.push('position');
      } else if (routeFraction < 0.8) {
        posScore = 0.6 - (routeFraction - 0.6) * 1.5;
        positionLabel = 'Late on route';
        confidenceFactors.push('position');
      } else {
        posScore = Math.max(0.05, 0.3 - (routeFraction - 0.8) * 1.5);
        positionLabel = 'Near destination';
        confidenceFactors.push('position');
      }

      // ── FACTOR 3: Time Compatibility (20%) ──
      const timeDiffMin = Math.abs(
        new Date(ride.departure_time).getTime() - new Date(departure_time).getTime()
      ) / 60000;
      const timeScore = sigmoidTimeScore(timeDiffMin);
      if (timeDiffMin <= 120) confidenceFactors.push('time');

      // ── FACTOR 4: Proximity (15%) ──
      const proxScore = proximityScore(pickupDist);
      confidenceFactors.push('proximity');

      // ── WEIGHTED FINAL SCORE ──
      const finalScore =
        (detourScore * WEIGHTS.detour) +
        (posScore     * WEIGHTS.position) +
        (timeScore    * WEIGHTS.time) +
        (proxScore    * WEIGHTS.proximity);

      // ── CONFIDENCE ──
      let confidence;
      if (confidenceFactors.length >= 4) confidence = 'high';
      else if (confidenceFactors.length >= 3) confidence = 'medium';
      else confidence = 'low';

      // ── HUMAN LABELS ──
      let timeLabel;
      if (timeDiffMin < 5)        timeLabel = 'Same time';
      else if (timeDiffMin < 60)  timeLabel = `${Math.round(timeDiffMin)} min apart`;
      else                        timeLabel = `${Math.round(timeDiffMin / 60)}h+ apart`;

      let detourLabel;
      if (!detourExtraMeters || detourExtraMeters === 0) detourLabel = 'On route';
      else if (detourExtraMeters < 500)                  detourLabel = 'Minimal detour';
      else                                               detourLabel = `+${(detourExtraMeters / 1000).toFixed(1)} km detour`;

      let distanceLabel;
      if (pickupDist < 500)       distanceLabel = 'Very close';
      else if (pickupDist < 2000) distanceLabel = `${Math.round(pickupDist / 100) * 100}m away`;
      else                        distanceLabel = `${(pickupDist / 1000).toFixed(1)} km away`;

      scoredResults.push({
        ride_id:               ride.id,
        driver_name:           ride.driver_name,
        start_location:        ride.start_location,
        end_location:          ride.end_location,
        departure_time:        ride.departure_time,
        available_seats:       ride.available_seats,
        compatibility_score:   Math.round(finalScore * 100),
        confidence,
        pickup_distance_meters: Math.round(pickupDist),
        distance_label:        distanceLabel,
        detour_label:          detourLabel,
        detour_extra_meters:   detourExtraMeters,
        position_label:        positionLabel,
        time_label:            timeLabel,
        time_diff_minutes:     Math.round(timeDiffMin),
        score_breakdown: {
          detour:    Math.round(detourScore * 100),
          position:  Math.round(posScore * 100),
          time:      Math.round(timeScore * 100),
          proximity: Math.round(proxScore * 100)
        }
      });
    }

    // ──────────────────────────────────────────
    // STEP 4 — Sort (no score floor — every match is shown)
    // ──────────────────────────────────────────
    scoredResults.sort((a, b) => b.compatibility_score - a.compatibility_score);

    res.json({
      matches: scoredResults,
      total_candidates: candidateQuery.rows.length,
      message: `Found ${scoredResults.length} compatible ride${scoredResults.length !== 1 ? 's' : ''}.`
    });

  } catch (err) {
    console.error('Match error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

---

## frontend/src/App.js

```javascript
import { useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

function App() {
  const [token, setToken] = useState(null);
  const [role, setRole] = useState(null);

  const handleLogin = (token, role) => {
    setToken(token);
    setRole(role);
  };

  const handleLogout = () => {
    setToken(null);
    setRole(null);
  };

  return (
    <div>
      {!token ? (
        <Login onLogin={handleLogin} />
      ) : (
        <Dashboard token={token} role={role} onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;
```

---

## frontend/src/index.css

```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #fffbeb;
  color: #1c1917;
  min-height: 100vh;
  font-size: 15px;
}

button {
  cursor: pointer;
  font-family: inherit;
}

input, select {
  font-family: inherit;
}

.leaflet-container {
  border-radius: 8px;
}
```

---

## frontend/src/components/Login.js

```javascript
import { useState } from 'react';
import axios from 'axios';

// Yellow palette
const C = {
  bg:          '#fffbeb',
  card:        '#ffffff',
  border:      '#fde68a',
  accent:      '#d97706',
  accentDark:  '#b45309',
  text:        '#1c1917',
  muted:       '#78716c',
  faint:       '#a8a29e',
  successBg:   '#f0faf5',
  successBorder:'#b7e4c7',
  successText: '#15803d',
  errorBg:     '#fdf3f2',
  errorBorder: '#f5c6c2',
  errorText:   '#c0392b',
};

export default function Login({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('passenger');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(''); setSuccess('');
    if (!regNumber || !password) { setError('Please fill in all fields.'); return; }
    if (isRegister && !name) { setError('Please enter your name.'); return; }
    setLoading(true);
    try {
      if (isRegister) {
        await axios.post('http://localhost:5000/api/auth/register', { name, reg_number: regNumber, password, role });
        setSuccess('Account created! You can now sign in.');
        setIsRegister(false);
        setName(''); setRegNumber(''); setPassword('');
      } else {
        const res = await axios.post('http://localhost:5000/api/auth/login', { reg_number: regNumber, password });
        onLogin(res.data.token, res.data.role);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleSubmit(); };

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${C.border}`,
    borderRadius: '6px',
    fontSize: '15px',
    outline: 'none',
    background: C.card,
    color: C.text,
    marginBottom: '12px',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  const switchMode = () => { setIsRegister(v => !v); setError(''); setSuccess(''); };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        {/* Brand */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '22px', fontWeight: '700', color: C.text, letterSpacing: '-0.3px' }}>
            CampusCarGO
          </div>
          <div style={{ color: C.muted, fontSize: '14px', marginTop: '4px' }}>
            Ride sharing for SCT students
          </div>
        </div>

        {/* Card */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '28px' }}>
          <div style={{ fontSize: '17px', fontWeight: '600', marginBottom: '20px', color: C.text }}>
            {isRegister ? 'Create an account' : 'Sign in'}
          </div>

          {isRegister && (
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown} placeholder="Full name" style={inputStyle}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = C.border}
            />
          )}

          <input
            type="text" value={regNumber} onChange={e => setRegNumber(e.target.value)}
            onKeyDown={handleKeyDown} placeholder="Registration number" style={inputStyle}
            onFocus={e => e.target.style.borderColor = C.accent}
            onBlur={e => e.target.style.borderColor = C.border}
          />

          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={handleKeyDown} placeholder="Password"
            style={{ ...inputStyle, marginBottom: isRegister ? '16px' : '4px' }}
            onFocus={e => e.target.style.borderColor = C.accent}
            onBlur={e => e.target.style.borderColor = C.border}
          />

          {isRegister && (
            <div style={{ marginBottom: '4px' }}>
              <div style={{ fontSize: '13px', color: C.muted, marginBottom: '8px' }}>I am a</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {['passenger', 'driver'].map(r => (
                  <button key={r} onClick={() => setRole(r)} style={{
                    padding: '10px',
                    border: `1px solid ${role === r ? C.accent : C.border}`,
                    borderRadius: '6px',
                    background: role === r ? C.accent : C.card,
                    color: role === r ? 'white' : C.muted,
                    fontWeight: '500',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}>
                    {r === 'driver' ? 'Driver' : 'Passenger'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: '13px', color: C.errorText, marginTop: '14px', padding: '10px 12px', background: C.errorBg, borderRadius: '6px', border: `1px solid ${C.errorBorder}` }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{ fontSize: '13px', color: C.successText, marginTop: '14px', padding: '10px 12px', background: C.successBg, borderRadius: '6px', border: `1px solid ${C.successBorder}` }}>
              {success}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading} style={{
            width: '100%', padding: '11px', marginTop: '16px',
            background: loading ? C.faint : C.accent,
            color: 'white', border: 'none', borderRadius: '6px',
            fontSize: '15px', fontWeight: '600',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}>
            {loading ? 'Please wait...' : isRegister ? 'Create account' : 'Sign in'}
          </button>

          <div style={{ textAlign: 'center', marginTop: '18px', fontSize: '13px', color: C.muted }}>
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button onClick={switchMode} style={{
              background: 'none', border: 'none', color: C.accent,
              fontWeight: '600', fontSize: '13px', cursor: 'pointer',
              textDecoration: 'underline', padding: 0,
            }}>
              {isRegister ? 'Sign in' : 'Register'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## frontend/src/components/Dashboard.js

```javascript
import { useState, useEffect } from 'react';
import axios from 'axios';
import MapPicker from './MapPicker';

// Yellow palette — single source of truth
const C = {
  bg:            '#fffbeb',
  card:          '#ffffff',
  subtle:        '#fefce8',
  border:        '#fde68a',
  borderLight:   '#fef3c7',
  accent:        '#d97706',
  accentDark:    '#b45309',
  text:          '#1c1917',
  muted:         '#78716c',
  faint:         '#a8a29e',
  successBg:     '#f0faf5',
  successBorder: '#b7e4c7',
  successText:   '#15803d',
  errorBg:       '#fdf3f2',
  errorBorder:   '#f5c6c2',
  errorText:     '#c0392b',
};

export default function Dashboard({ token, role, onLogout }) {
  const [pickupLocation, setPickupLocation] = useState(null);
  const [departureTime, setDepartureTime] = useState('');
  const [seats, setSeats] = useState(1);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState([]);
  const [myStatus, setMyStatus] = useState([]);
  const [myRides, setMyRides] = useState([]);

  const SCT = { lat: 8.5241, lng: 76.9366, name: 'SCT Pappanamcode' };

  const showMessage = (msg, type = 'success') => { setMessage(msg); setMessageType(type); };

  useEffect(() => {
    if (role === 'driver') { fetchRequests(); fetchMyRides(); }
    if (role === 'passenger') fetchMyStatus();
  }, []);

  const fetchRequests = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/requests', { headers: { Authorization: token } });
      setRequests(res.data.requests);
    } catch (err) { console.error(err); }
  };

  const fetchMyRides = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/myrides', { headers: { Authorization: token } });
      setMyRides(res.data.rides);
    } catch (err) { console.error(err); }
  };

  const handleDeleteRide = async (rideId) => {
    if (!window.confirm('Delete this ride?')) return;
    try {
      await axios.delete(`http://localhost:5000/api/rides/delete/${rideId}`, { headers: { Authorization: token } });
      showMessage('Ride deleted.', 'success');
      fetchMyRides();
    } catch (err) { showMessage(err.response?.data?.error || 'Error deleting ride', 'error'); }
  };

  const fetchMyStatus = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/mystatus', { headers: { Authorization: token } });
      setMyStatus(res.data.requests);
    } catch (err) { console.error(err); }
  };

  const handlePostRide = async () => {
    if (!pickupLocation) { showMessage('Please select a start location.', 'error'); return; }
    if (!departureTime) { showMessage('Please select a departure time.', 'error'); return; }
    setLoading(true);
    try {
      await axios.post('http://localhost:5000/api/rides/post', {
        start_location: pickupLocation.name, end_location: SCT.name,
        departure_time: departureTime, available_seats: seats,
        start_lat: pickupLocation.lat, start_lng: pickupLocation.lng,
        end_lat: SCT.lat, end_lng: SCT.lng,
      }, { headers: { Authorization: token } });
      showMessage('Ride posted successfully.', 'success');
    } catch (err) { showMessage(err.response?.data?.error || 'Error posting ride', 'error'); }
    setLoading(false);
  };

  const handleFindRides = async () => {
    if (!pickupLocation) { showMessage('Please select your pickup location.', 'error'); return; }
    if (!departureTime) { showMessage('Please select a departure time.', 'error'); return; }
    setLoading(true);
    try {
      const res = await axios.post('http://localhost:5000/api/match/find', {
        pickup_lat: pickupLocation.lat, pickup_lng: pickupLocation.lng,
        dropoff_lat: SCT.lat, dropoff_lng: SCT.lng, departure_time: departureTime,
      }, { headers: { Authorization: token } });
      setMatches(res.data.matches);
      if (res.data.matches.length === 0) showMessage(res.data.message || 'No rides found near your location.', 'error');
      else setMessage('');
    } catch (err) { showMessage(err.response?.data?.error || 'Error finding rides', 'error'); }
    setLoading(false);
  };

  const handleRequestRide = async (rideId) => {
    if (!pickupLocation) return;
    try {
      await axios.post('http://localhost:5000/api/rides/request', {
        ride_id: rideId, pickup_location: pickupLocation.name, dropoff_location: SCT.name,
      }, { headers: { Authorization: token } });
      showMessage('Ride requested. Waiting for driver confirmation.', 'success');
      fetchMyStatus();
    } catch (err) { showMessage(err.response?.data?.error || 'Error requesting ride', 'error'); }
  };

  const handleRespond = async (requestId, action) => {
    try {
      await axios.post('http://localhost:5000/api/rides/respond', { request_id: requestId, action }, { headers: { Authorization: token } });
      showMessage(`Request ${action}.`, 'success');
      fetchRequests();
    } catch (err) { showMessage(err.response?.data?.error || 'Error responding', 'error'); }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px',
    border: `1px solid ${C.border}`, borderRadius: '6px',
    fontSize: '15px', outline: 'none',
    background: C.card, color: C.text,
    transition: 'border-color 0.15s',
  };

  const labelStyle = { display: 'block', fontSize: '13px', color: C.muted, marginBottom: '6px' };

  const refreshBtn = (onClick) => (
    <button onClick={onClick} style={{
      padding: '6px 12px', background: C.card,
      border: `1px solid ${C.border}`, borderRadius: '6px',
      fontSize: '13px', color: C.muted, cursor: 'pointer',
      transition: 'border-color 0.15s',
    }}>Refresh</button>
  );

  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px' };

  const statusBadge = (status) => {
    const map = {
      accepted: { bg: C.successBg,  color: C.successText,  text: 'Accepted' },
      rejected: { bg: C.errorBg,    color: C.errorText,    text: 'Rejected' },
      pending:  { bg: '#fefce8',     color: C.accent,       text: 'Pending'  },
    };
    const s = map[status] || map.pending;
    return (
      <span style={{ background: s.bg, color: s.color, padding: '4px 10px', borderRadius: '4px', fontSize: '13px', fontWeight: '600' }}>
        {s.text}
      </span>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>

      {/* Navbar */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: '0 24px', height: '56px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontWeight: '700', fontSize: '17px', color: C.text, letterSpacing: '-0.3px' }}>
          CampusCarGO
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '13px', color: C.muted }}>
            {role === 'driver' ? 'Driver' : 'Passenger'}
          </span>
          <button onClick={onLogout} style={{
            padding: '7px 14px', background: C.card,
            border: `1px solid ${C.border}`, borderRadius: '6px',
            fontSize: '13px', fontWeight: '500', color: C.text, cursor: 'pointer',
            transition: 'border-color 0.15s',
          }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 20px' }}>

        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.text }}>
            {role === 'driver' ? 'Post a ride' : 'Find a ride'}
          </h1>
          <p style={{ color: C.muted, marginTop: '4px', fontSize: '14px' }}>
            {role === 'driver'
              ? 'Share your route to SCT and pick up passengers along the way.'
              : 'Find a driver heading to SCT near your location.'}
          </p>
        </div>

        {/* Form card */}
        <div style={{ ...card, padding: '24px', marginBottom: '24px' }}>
          <MapPicker
            label={role === 'driver' ? 'Start location' : 'Pickup location'}
            onLocationSelect={setPickupLocation}
          />

          {/* Destination */}
          <div style={{ marginBottom: '18px' }}>
            <label style={labelStyle}>Destination</label>
            <div style={{
              padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: '6px',
              fontSize: '15px', color: C.faint, background: C.subtle,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>SCT Pappanamcode</span>
              <span style={{ fontSize: '12px', color: C.faint }}>fixed</span>
            </div>
          </div>

          {/* Departure time */}
          <div style={{ marginBottom: '18px' }}>
            <label style={labelStyle}>Departure time</label>
            <input
              type="datetime-local" value={departureTime}
              onChange={e => setDepartureTime(e.target.value)}
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = C.border}
            />
          </div>

          {/* Seats (driver only) */}
          {role === 'driver' && (
            <div style={{ marginBottom: '18px' }}>
              <label style={labelStyle}>Available seats</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <button key={n} onClick={() => setSeats(n)} style={{
                    width: '40px', height: '40px',
                    border: `1px solid ${seats === n ? C.accent : C.border}`,
                    borderRadius: '6px',
                    background: seats === n ? C.accent : C.card,
                    color: seats === n ? 'white' : C.muted,
                    fontWeight: '600', fontSize: '15px', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}>{n}</button>
                ))}
              </div>
            </div>
          )}

          {/* Inline message */}
          {message && (
            <div style={{
              padding: '10px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '14px',
              background: messageType === 'success' ? C.successBg : C.errorBg,
              border: `1px solid ${messageType === 'success' ? C.successBorder : C.errorBorder}`,
              color: messageType === 'success' ? C.successText : C.errorText,
            }}>
              {message}
            </div>
          )}

          <button
            onClick={role === 'driver' ? handlePostRide : handleFindRides}
            disabled={loading}
            style={{
              width: '100%', padding: '11px',
              background: loading ? C.faint : C.accent,
              color: 'white', border: 'none', borderRadius: '6px',
              fontSize: '15px', fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}>
            {loading ? 'Please wait...' : role === 'driver' ? 'Post ride' : 'Find rides'}
          </button>
        </div>

        {/* Driver: My Posted Rides */}
        {role === 'driver' && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>
                My posted rides{' '}
                {myRides.length > 0 && <span style={{ color: C.muted, fontWeight: '400', fontSize: '14px' }}>({myRides.length})</span>}
              </h2>
              {refreshBtn(fetchMyRides)}
            </div>

            {myRides.length === 0 ? (
              <div style={{ ...card, padding: '24px', textAlign: 'center', color: C.faint, fontSize: '14px' }}>
                No rides posted yet.
              </div>
            ) : myRides.map((r, i) => (
              <div key={i} style={{
                ...card, padding: '18px', marginBottom: '10px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{r.start_location} → SCT</div>
                  <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>
                    {new Date(r.departure_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  <div style={{ color: C.faint, fontSize: '13px', marginTop: '2px' }}>
                    {r.available_seats} seat{r.available_seats !== 1 ? 's' : ''} · {r.status}
                  </div>
                </div>
                <button onClick={() => handleDeleteRide(r.id)} style={{
                  padding: '7px 14px', background: C.card, color: C.errorText,
                  border: `1px solid ${C.errorBorder}`, borderRadius: '6px',
                  fontSize: '13px', fontWeight: '500', cursor: 'pointer',
                }}>Delete</button>
              </div>
            ))}
          </div>
        )}

        {/* Driver: Incoming Requests */}
        {role === 'driver' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>
                Incoming requests
                {requests.length > 0 && (
                  <span style={{
                    marginLeft: '8px', background: C.accent, color: 'white',
                    fontSize: '12px', padding: '2px 8px', borderRadius: '10px',
                  }}>{requests.length}</span>
                )}
              </div>
              {refreshBtn(fetchRequests)}
            </div>

            {requests.length === 0 ? (
              <div style={{ ...card, padding: '24px', textAlign: 'center', color: C.faint, fontSize: '14px' }}>
                No pending requests.
              </div>
            ) : requests.map((r, i) => (
              <div key={i} style={{ ...card, padding: '18px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{r.passenger_name}</div>
                    <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>Pickup: {r.pickup_location}</div>
                    <div style={{ color: C.faint, fontSize: '13px' }}>
                      {new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button onClick={() => handleRespond(r.id, 'accepted')} style={{
                    padding: '9px', background: C.accent, color: 'white',
                    border: 'none', borderRadius: '6px', fontWeight: '600', fontSize: '14px', cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}>Accept</button>
                  <button onClick={() => handleRespond(r.id, 'rejected')} style={{
                    padding: '9px', background: C.card, color: C.errorText,
                    border: `1px solid ${C.errorBorder}`, borderRadius: '6px',
                    fontWeight: '600', fontSize: '14px', cursor: 'pointer',
                  }}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Passenger: Ride Results */}
        {role === 'passenger' && matches.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>
                {matches.length} ride{matches.length > 1 ? 's' : ''} found
              </div>
            </div>

            {matches.map((m, i) => {
              const scoreColor = m.compatibility_score >= 60 ? C.successText : m.compatibility_score >= 35 ? C.accent : C.errorText;
              const confColor = m.confidence === 'high' ? C.successText : m.confidence === 'medium' ? C.accent : C.errorText;
              const confBg = m.confidence === 'high' ? C.successBg : m.confidence === 'medium' ? C.subtle : C.errorBg;

              return (
              <div key={i} style={{ ...card, padding: '18px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{m.driver_name}</div>
                    <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>From: {m.start_location}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '20px', fontWeight: '700', color: scoreColor }}>
                      {m.compatibility_score}%
                    </div>
                    <span style={{
                      background: confBg, color: confColor,
                      padding: '2px 8px', borderRadius: '4px',
                      fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
                    }}>{m.confidence}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                  {[
                    { icon: '🕐', text: m.time_label || new Date(m.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
                    { icon: '💺', text: `${m.available_seats} seat${m.available_seats !== 1 ? 's' : ''}` },
                    { icon: '📍', text: m.distance_label || `${m.pickup_distance_meters}m away` },
                    { icon: '🛣️', text: m.detour_label || 'On route' },
                    { icon: '📌', text: m.position_label || '' },
                  ].filter(c => c.text).map((chip, j) => (
                    <span key={j} style={{
                      background: C.subtle, padding: '4px 10px', borderRadius: '20px',
                      fontSize: '12px', color: C.muted, whiteSpace: 'nowrap',
                      border: `1px solid ${C.borderLight}`,
                    }}>{chip.icon} {chip.text}</span>
                  ))}
                </div>

                {m.score_breakdown && (
                  <div style={{
                    background: C.subtle, borderRadius: '8px', padding: '12px',
                    marginBottom: '14px', border: `1px solid ${C.borderLight}`,
                  }}>
                    <div style={{ fontSize: '12px', color: C.muted, marginBottom: '8px', fontWeight: '600' }}>Score Breakdown</div>
                    {[
                      { label: 'Detour Cost', value: m.score_breakdown.detour, weight: '40%' },
                      { label: 'Route Position', value: m.score_breakdown.position, weight: '25%' },
                      { label: 'Time Match', value: m.score_breakdown.time, weight: '20%' },
                      { label: 'Proximity', value: m.score_breakdown.proximity, weight: '15%' },
                    ].map((bar, k) => (
                      <div key={k} style={{ marginBottom: k < 3 ? '6px' : 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: C.faint, marginBottom: '3px' }}>
                          <span>{bar.label} <span style={{ color: C.borderLight }}>({bar.weight})</span></span>
                          <span style={{ fontWeight: '600', color: C.muted }}>{bar.value}%</span>
                        </div>
                        <div style={{ height: '4px', background: C.borderLight, borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${bar.value}%`, height: '100%', borderRadius: '2px',
                            background: bar.value >= 60 ? C.successText : bar.value >= 35 ? C.accent : C.errorText,
                            transition: 'width 0.5s ease',
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={() => handleRequestRide(m.ride_id)} style={{
                  width: '100%', padding: '10px',
                  background: C.accent, color: 'white',
                  border: 'none', borderRadius: '6px',
                  fontWeight: '600', fontSize: '14px', cursor: 'pointer',
                  transition: 'background 0.15s',
                }}>Request ride</button>
              </div>
              );
            })}
          </div>
        )}

        {/* Passenger: empty state */}
        {role === 'passenger' && matches.length === 0 && myStatus.length === 0 && !message && (
          <div style={{ ...card, padding: '32px', textAlign: 'center', color: C.faint, fontSize: '14px' }}>
            Enter your pickup location and departure time, then tap{' '}
            <strong style={{ color: C.muted }}>Find rides</strong>.
          </div>
        )}

        {/* Passenger: My Requests */}
        {role === 'passenger' && myStatus.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>My requests</div>
              {refreshBtn(fetchMyStatus)}
            </div>
            {myStatus.map((r, i) => (
              <div key={i} style={{
                ...card, padding: '16px', marginBottom: '10px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{r.driver_name}</div>
                  <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>From: {r.start_location}</div>
                  <div style={{ color: C.faint, fontSize: '13px' }}>
                    {new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {statusBadge(r.status)}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
```

---

## frontend/src/components/MapPicker.js

```javascript
import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const C = {
  border:    '#fde68a',
  accent:    '#d97706',
  subtle:    '#fefce8',
  text:      '#1c1917',
  muted:     '#78716c',
  faint:     '#a8a29e',
};

function FlyToLocation({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo([position.lat, position.lng], 15, { duration: 1 });
  }, [position, map]);
  return null;
}

function ClickHandler({ onMapClick }) {
  useMapEvents({ click(e) { onMapClick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

export default function MapPicker({ label, onLocationSelect }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [marker, setMarker] = useState(null);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const debounceTimer = useRef(null);
  const wrapperRef = useRef(null);

  const SCT = { lat: 8.5241, lng: 76.9366 };

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setSuggestions([]);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = (e) => {
    const val = e.target.value;
    setQuery(val);
    setSuggestions([]);
    setHoveredIdx(-1);
    if (val.length < 3) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/maps/search?q=${encodeURIComponent(val)}`);
        const data = await res.json();
        setSuggestions(data);
      } catch (err) { console.error('Search error:', err); }
    }, 500);
  };

  const handleSelect = (place) => {
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);
    const name = place.display_name.split(',')[0];
    setMarker({ lat, lng });
    setQuery(name);
    setSuggestions([]);
    setHoveredIdx(-1);
    onLocationSelect({ lat, lng, name });
  };

  const handleMapClick = (lat, lng) => {
    const name = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    setMarker({ lat, lng });
    setSuggestions([]);
    setQuery(name);
    onLocationSelect({ lat, lng, name });
  };

  const handleKeyDown = (e) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown')        { e.preventDefault(); setHoveredIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp')     { e.preventDefault(); setHoveredIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && hoveredIdx >= 0) handleSelect(suggestions[hoveredIdx]);
    else if (e.key === 'Escape')      setSuggestions([]);
  };

  const open = suggestions.length > 0;

  return (
    <div style={{ marginBottom: '20px' }}>
      <label style={{ display: 'block', fontSize: '13px', color: C.muted, marginBottom: '6px' }}>
        {label}
      </label>

      <div ref={wrapperRef} style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={handleSearch}
          onKeyDown={handleKeyDown}
          placeholder="Search a place or click on the map..."
          style={{
            width: '100%',
            padding: '10px 12px',
            border: `1px solid ${open ? C.accent : C.border}`,
            borderRadius: open ? '6px 6px 0 0' : '6px',
            fontSize: '15px',
            outline: 'none',
            background: 'white',
            color: C.text,
            boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = C.accent}
          onBlur={e => { if (!open) e.target.style.borderColor = C.border; }}
        />

        {open && (
          <ul style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            listStyle: 'none', padding: 0, margin: 0,
            background: 'white',
            border: `1px solid ${C.accent}`, borderTop: 'none',
            borderRadius: '0 0 6px 6px',
            zIndex: 1000, maxHeight: '200px', overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}>
            {suggestions.map((s, i) => (
              <li
                key={i}
                onMouseDown={() => handleSelect(s)}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(-1)}
                style={{
                  padding: '10px 12px', cursor: 'pointer', fontSize: '13px', color: C.text,
                  borderBottom: i < suggestions.length - 1 ? `1px solid #fef3c7` : 'none',
                  background: hoveredIdx === i ? C.subtle : 'white',
                  transition: 'background 0.1s',
                }}
              >
                <span style={{ fontWeight: '500' }}>{s.display_name.split(',')[0]}</span>
                <span style={{ color: C.faint, marginLeft: '6px' }}>
                  {s.display_name.split(',').slice(1, 3).join(',')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: '8px', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
        <MapContainer center={[SCT.lat, SCT.lng]} zoom={13} style={{ height: '260px', width: '100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />
          <ClickHandler onMapClick={handleMapClick} />
          {marker && (
            <>
              <Marker position={[marker.lat, marker.lng]} />
              <FlyToLocation position={marker} />
            </>
          )}
        </MapContainer>
      </div>

      {marker && (
        <div style={{ marginTop: '6px', fontSize: '12px', color: C.accent, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '500' }}>
          <span>&#10003;</span>
          <span>{query}</span>
        </div>
      )}
    </div>
  );
}
```
