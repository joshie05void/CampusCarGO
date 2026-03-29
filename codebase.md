# CampusCarGO — Full Codebase Reference

Campus ride-sharing app for SCT students. **Backend**: Node.js + Express + PostgreSQL (PostGIS). **Frontend**: React + Leaflet.

---

## Project Structure

```
CampusCarGO/
├── backend/
│   ├── server.js
│   ├── package.json
│   ├── config/
│   │   └── db.js
│   └── routes/
│       ├── auth.js
│       ├── rides.js
│       ├── maps.js
│       └── match.js
└── frontend/
    ├── package.json
    ├── public/
    │   └── index.html
    └── src/
        ├── index.js
        ├── index.css
        ├── App.js
        ├── App.css
        └── components/
            ├── Login.js
            ├── Dashboard.js
            └── MapPicker.js
```

---

## Backend

### `backend/package.json`

```json
{
  "name": "backend",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "axios": "^1.13.6",
    "bcryptjs": "^3.0.3",
    "cors": "^2.8.6",
    "dotenv": "^17.3.1",
    "express": "^5.2.1",
    "jsonwebtoken": "^9.0.3",
    "pg": "^8.20.0"
  }
}
```

---

### `backend/server.js`

Entry point. Mounts all route groups.

```js
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

app.get('/', (req, res) => res.send('CampusCarGO backend is running'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
```

---

### `backend/config/db.js`

PostgreSQL connection pool.

```js
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

### `backend/routes/auth.js`

User registration (bcrypt hash) and login (JWT, 7-day expiry).

```js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

router.post('/register', async (req, res) => {
  const { name, reg_number, password, role } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, reg_number, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, reg_number, hashedPassword, role]
    );
    res.json({ message: 'User registered successfully', user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
```

---

### `backend/routes/rides.js`

CRUD for rides and ride requests. JWT-protected; driver/passenger roles enforced per route.

**Routes:**
- `POST /post` — driver posts a ride (fetches ORS route → stores PostGIS geometry)
- `GET /available` — all active rides
- `POST /request` — passenger requests a ride
- `GET /requests` — driver sees pending requests
- `POST /respond` — driver accepts/rejects; accepts decrement available seats
- `GET /mystatus` — passenger's request history
- `GET /myrides` — driver's posted rides
- `DELETE /delete/:id` — driver deletes a ride

```js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch (err) { res.status(401).json({ error: 'Invalid token' }); }
};

router.post('/post', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can post rides' });
  const { start_location, end_location, departure_time, available_seats,
          start_lat, start_lng, end_lat, end_lng } = req.body;
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/available', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT rides.*, users.name as driver_name FROM rides JOIN users ON rides.driver_id = users.id WHERE rides.status = $1",
      ['active']
    );
    res.json({ rides: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/request', verifyToken, async (req, res) => {
  if (req.user.role !== 'passenger') return res.status(403).json({ error: 'Only passengers can request rides' });
  const { ride_id, pickup_location, dropoff_location } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO ride_requests (ride_id, passenger_id, pickup_location, dropoff_location) VALUES ($1, $2, $3, $4) RETURNING *',
      [ride_id, req.user.id, pickup_location, dropoff_location]
    );
    res.json({ message: 'Ride request sent successfully', request: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/respond', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can respond to requests' });
  const { request_id, action } = req.body;
  if (!['accepted', 'rejected'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    await pool.query('UPDATE ride_requests SET status = $1 WHERE id = $2', [action, request_id]);
    if (action === 'accepted') {
      await pool.query(
        `UPDATE rides SET available_seats = available_seats - 1
         WHERE id = (SELECT ride_id FROM ride_requests WHERE id = $1) AND available_seats > 0`,
        [request_id]
      );
    }
    res.json({ message: `Request ${action} successfully` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/myrides', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can view their rides' });
  try {
    const result = await pool.query(
      `SELECT * FROM rides WHERE driver_id = $1 ORDER BY created_at DESC`, [req.user.id]
    );
    res.json({ rides: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/delete/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can delete rides' });
  try {
    await pool.query(`DELETE FROM rides WHERE id = $1 AND driver_id = $2`, [req.params.id, req.user.id]);
    res.json({ message: 'Ride deleted successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
```

---

### `backend/routes/maps.js`

Wraps OpenRouteService (directions) and Nominatim (geocoding).

```js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch (err) { res.status(401).json({ error: 'Invalid token' }); }
};

// POST /api/maps/route
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/maps/search?q=  — Nominatim, scoped to Thiruvananthapuram
router.get('/search', async (req, res) => {
  const { q } = req.query;
  try {
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}, Thiruvananthapuram&format=json&limit=5`,
      { headers: { 'User-Agent': 'CampusCarGO/1.0' } }
    );
    res.json(response.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
```

---

### `backend/routes/match.js`

Smart ride matching algorithm. Scores candidates across 5 dimensions with dynamic weights.

| Feature | Detail |
|---------|--------|
| Radius expansion | 500m → 1km → 1.5km with increasing penalty |
| Proximity score | Distance to polyline / search radius |
| Time score | Sigmoid decay, steep drop at 15 min diff |
| Detour score | Real ORS call: extra meters driver must travel |
| Overlap score | PostGIS buffer intersection of driver & passenger routes |
| Cluster bonus | +0.05 per existing accepted passenger (max 0.10) |
| Direction multiplier | Bearing diff ≤45° = 1.0, ≤90° = 0.75, else max(0.3, …) |
| Dynamic weights | Shift for peak hour (8–9 AM), low supply, scarce seats |
| Confidence label | High / Medium / Low based on data completeness |

```js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch (err) { res.status(401).json({ error: 'Invalid token' }); }
};

function getBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1r = lat1 * Math.PI / 180;
  const lat2r = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function sigmoidTimeScore(diffMinutes) {
  return 1 / (1 + Math.exp(0.3 * (diffMinutes - 15)));
}

function getDynamicWeights({ hour, totalRides, seatsLeft }) {
  let w = { proximity: 0.20, time: 0.25, detour: 0.30, overlap: 0.15, seat: 0.10 };
  if (hour >= 8 && hour < 9) {
    w.detour = 0.35; w.proximity = 0.25; w.time = 0.20; w.overlap = 0.12; w.seat = 0.08;
  }
  if (totalRides < 3) { w.time = Math.max(0.10, w.time - 0.10); w.detour += 0.05; w.proximity += 0.05; }
  if (seatsLeft === 1) { w.seat = Math.min(0.20, w.seat + 0.10); w.overlap = Math.max(0.05, w.overlap - 0.05); }
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  Object.keys(w).forEach(k => w[k] /= sum);
  return w;
}

async function callORS(coordinates) {
  const response = await axios.post(
    'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
    { coordinates },
    { headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
  );
  return response.data;
}

router.post('/find', verifyToken, async (req, res) => {
  const { pickup_lat, pickup_lng, departure_time } = req.body;
  const SCT_LAT = 8.5241, SCT_LNG = 76.9366;

  try {
    let candidateRides = [], searchRadius = 500, radiusPenalty = 0;

    for (const [radius, penalty] of [[500, 0], [1000, 0.10], [1500, 0.20]]) {
      const result = await pool.query(
        `SELECT r.*, u.name as driver_name,
           ST_Distance(r.route_polyline::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as pickup_distance,
           ST_Length(r.route_polyline::geography) as original_route_m,
           ST_X(ST_StartPoint(r.route_polyline::geometry)) as start_lng,
           ST_Y(ST_StartPoint(r.route_polyline::geometry)) as start_lat,
           (SELECT COUNT(*) FROM ride_requests rr WHERE rr.ride_id = r.id AND rr.status = 'accepted') as accepted_count
         FROM rides r JOIN users u ON r.driver_id = u.id
         WHERE r.status = 'active' AND r.available_seats > 0
           AND ST_Distance(r.route_polyline::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) < $3`,
        [pickup_lng, pickup_lat, radius]
      );
      if (result.rows.length > 0) { candidateRides = result.rows; searchRadius = radius; radiusPenalty = penalty; break; }
    }

    if (candidateRides.length === 0)
      return res.json({ matches: [], message: 'No rides found within 1.5km of your location.' });

    const totalRides = candidateRides.length;
    const requestedTime = new Date(departure_time);
    const hour = requestedTime.getHours();

    let passengerLinestring = null;
    try {
      const pORS = await callORS([[pickup_lng, pickup_lat], [SCT_LNG, SCT_LAT]]);
      const coords = pORS.features[0].geometry.coordinates;
      passengerLinestring = 'LINESTRING(' + coords.map(c => `${c[0]} ${c[1]}`).join(',') + ')';
    } catch (e) {}

    const scored = await Promise.all(candidateRides.map(async (ride) => {
      const pickupDistance = parseFloat(ride.pickup_distance);
      const originalRouteM = parseFloat(ride.original_route_m);
      const driverStartLng = parseFloat(ride.start_lng);
      const driverStartLat = parseFloat(ride.start_lat);
      const acceptedCount = parseInt(ride.accepted_count) || 0;

      const timeDiff = Math.abs(new Date(ride.departure_time) - requestedTime) / 60000;
      const timeScore = sigmoidTimeScore(timeDiff);
      const proximityScore = Math.max(0, 1 - (pickupDistance / searchRadius));

      let detourScore = proximityScore, extraMeters = null;
      try {
        const dORS = await callORS([[driverStartLng, driverStartLat], [pickup_lng, pickup_lat], [SCT_LNG, SCT_LAT]]);
        const detourM = dORS.features[0].properties.summary.distance;
        extraMeters = Math.max(0, detourM - originalRouteM);
        detourScore = Math.max(0, 1 - (extraMeters / 2000));
      } catch (e) {}

      let overlapScore = 0.5;
      if (passengerLinestring) {
        try {
          const ov = await pool.query(
            `SELECT ST_Length(ST_Intersection(route_polyline, ST_Buffer(ST_GeomFromText($1, 4326), 0.0009))::geography)
               / NULLIF(ST_Length(route_polyline::geography), 0) as ratio FROM rides WHERE id = $2`,
            [passengerLinestring, ride.id]
          );
          const ratio = ov.rows[0]?.ratio;
          if (ratio != null && !isNaN(ratio)) overlapScore = Math.min(1, Math.max(0, parseFloat(ratio)));
        } catch (e) {}
      }

      const clusterBonus = Math.min(0.10, acceptedCount * 0.05);

      const driverBearing = getBearing(driverStartLat, driverStartLng, SCT_LAT, SCT_LNG);
      const pickupBearing = getBearing(driverStartLat, driverStartLng, pickup_lat, pickup_lng);
      let angleDiff = Math.abs(driverBearing - pickupBearing);
      if (angleDiff > 180) angleDiff = 360 - angleDiff;
      const directionMultiplier = angleDiff <= 45 ? 1.0 : angleDiff <= 90 ? 0.75 : Math.max(0.3, 1 - angleDiff / 180);

      const seatScore = Math.min(1, ride.available_seats / 4);
      const w = getDynamicWeights({ hour, totalRides, seatsLeft: ride.available_seats });

      const baseScore = (
        proximityScore * w.proximity + timeScore * w.time +
        detourScore * w.detour + overlapScore * w.overlap + seatScore * w.seat
      ) + clusterBonus;

      const finalScore = Math.max(0, Math.min(1, baseScore * directionMultiplier * (1 - radiusPenalty)));

      let cp = 0;
      if (extraMeters !== null) cp++;
      if (passengerLinestring) cp++;
      if (ride.route_polyline) cp++;
      if (timeDiff <= 60) cp++;
      if (ride.available_seats > 0) cp++;
      const confidenceLabel = cp >= 4 ? 'High' : cp >= 3 ? 'Medium' : 'Low';

      return {
        ride_id: ride.id, driver_name: ride.driver_name,
        start_location: ride.start_location, end_location: ride.end_location,
        departure_time: ride.departure_time, available_seats: ride.available_seats,
        pickup_distance_meters: Math.round(pickupDistance),
        compatibility_score: Math.round(finalScore * 100),
        confidence: confidenceLabel,
        detour_meters: extraMeters !== null ? Math.round(extraMeters) : null,
        expanded_radius: radiusPenalty > 0,
      };
    }));

    scored.sort((a, b) => b.compatibility_score - a.compatibility_score);
    res.json({ matches: scored, expanded_radius: radiusPenalty > 0, search_radius_m: searchRadius });

  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
```

---

## Frontend

### `frontend/src/index.css`

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f9f9f9; color: #1a1a1a; min-height: 100vh; font-size: 15px;
}
button { cursor: pointer; font-family: inherit; }
input, select { font-family: inherit; }
.leaflet-container { border-radius: 8px; }
```

---

### `frontend/src/App.js`

Root component — manages token + role state, renders Login or Dashboard.

```js
import { useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

function App() {
  const [token, setToken] = useState(null);
  const [role, setRole] = useState(null);

  const handleLogin = (token, role) => { setToken(token); setRole(role); };
  const handleLogout = () => { setToken(null); setRole(null); };

  return (
    <div>
      {!token
        ? <Login onLogin={handleLogin} />
        : <Dashboard token={token} role={role} onLogout={handleLogout} />}
    </div>
  );
}

export default App;
```

---

### `frontend/src/components/Login.js`

Dual-mode form (Sign In / Register). Role selector (driver/passenger) shown on register.  
Validates inputs, shows inline error/success banners, keyboard-submittable via Enter.

Key state: `isRegister`, `name`, `regNumber`, `password`, `role`, `error`, `success`, `loading`

API calls:
- `POST /api/auth/register` → shows success + switches to sign-in mode
- `POST /api/auth/login` → calls `onLogin(token, role)` prop

---

### `frontend/src/components/Dashboard.js`

Main screen after login. Adapts completely to `role` prop.

**Driver features:**
- MapPicker for start location
- Departure time + seat count (1–6 buttons)
- `POST /api/rides/post` to publish ride
- "My Posted Rides" list → delete via `DELETE /api/rides/delete/:id`
- "Incoming Requests" → Accept/Reject via `POST /api/rides/respond`

**Passenger features:**
- MapPicker for pickup location
- Departure time
- `POST /api/match/find` → ranked ride cards
- Each card shows: driver name, compatibility %, confidence, departure time, seats, pickup distance, detour
- "Request Ride" → `POST /api/rides/request`
- "My Requests" status tracker (pending / accepted / rejected badges)

---

### `frontend/src/components/MapPicker.js`

Reusable location picker combining a search bar and an interactive Leaflet map.

```js
import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Animates map view to selected position
function FlyToLocation({ position }) {
  const map = useMap();
  useEffect(() => { if (position) map.flyTo([position.lat, position.lng], 15, { duration: 1 }); }, [position, map]);
  return null;
}

// Handles clicks on the map
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
  const wrapperRef = useRef(null);  // for click-outside to close dropdown

  // Search: debounced 500ms, min 3 chars, hits GET /api/maps/search
  const handleSearch = (e) => { /* debounce → fetch → setSuggestions */ };

  // Select from dropdown
  const handleSelect = (place) => {
    const lat = parseFloat(place.lat), lng = parseFloat(place.lon);
    const name = place.display_name.split(',')[0];
    setMarker({ lat, lng }); setQuery(name); setSuggestions([]);
    onLocationSelect({ lat, lng, name });
  };

  // Click on map
  const handleMapClick = (lat, lng) => {
    const name = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    setMarker({ lat, lng }); setQuery(name);
    onLocationSelect({ lat, lng, name });
  };

  // Keyboard: ArrowUp/Down navigate suggestions, Enter selects, Escape closes
  const handleKeyDown = (e) => { /* ... */ };

  // Renders: label + search input + dropdown ul + 260px MapContainer + confirmation tick
}
```

---

## API Summary

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/api/auth/register` | — | any | Register user |
| POST | `/api/auth/login` | — | any | Login → JWT |
| POST | `/api/rides/post` | JWT | driver | Post a ride |
| GET | `/api/rides/available` | JWT | any | All active rides |
| POST | `/api/rides/request` | JWT | passenger | Request a ride |
| GET | `/api/rides/requests` | JWT | driver | Driver's pending requests |
| POST | `/api/rides/respond` | JWT | driver | Accept / reject request |
| GET | `/api/rides/mystatus` | JWT | passenger | Passenger request history |
| GET | `/api/rides/myrides` | JWT | driver | Driver's rides |
| DELETE | `/api/rides/delete/:id` | JWT | driver | Delete a ride |
| POST | `/api/maps/route` | JWT | any | ORS driving directions |
| GET | `/api/maps/search?q=` | — | any | Nominatim geocoding |
| POST | `/api/match/find` | JWT | passenger | Smart ride matching |

## Environment Variables (`.env`)

| Variable | Purpose |
|----------|---------|
| `DB_USER` | Postgres user |
| `DB_HOST` | Postgres host |
| `DB_NAME` | Database name |
| `DB_PASSWORD` | Postgres password |
| `DB_PORT` | Postgres port |
| `JWT_SECRET` | JWT signing secret |
| `ORS_API_KEY` | OpenRouteService API key |
| `PORT` | Backend server port (default 5000) |
