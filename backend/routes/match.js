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
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

async function callORS(coordinates) {
  const response = await axios.post(
    'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
    { coordinates },
    {
      headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json' },
      timeout: 10000,
    }
  );
  return response.data;
}

// Time score: 0-min diff ≈ 0.98 | 30-min ≈ 0.50 | 60-min ≈ 0.05
function timeScore(diffMinutes) {
  return 1 / (1 + Math.exp(0.1 * (diffMinutes - 30)));
}

// Detour score normalised to driver's own route length (not a fixed 2000m cap)
// 0% extra → 1.0 | 25% extra → 0.50 | 50%+ extra → 0.0
function detourScore(extraMeters, originalRouteMeters) {
  if (!originalRouteMeters || originalRouteMeters <= 0) return 0.5;
  const ratio = extraMeters / originalRouteMeters;
  return Math.max(0, 1 - ratio * 2);
}

// Pickup-position score: where along the route (0=start, 1=end/SCT) is the pickup?
// Ideal range 0.05–0.80. If pickup is in the last 20% of the route (driver almost
// at SCT already) it is useless for the passenger.
function pickupPositionScore(fraction) {
  if (isNaN(fraction)) return 0.5;
  if (fraction < 0.05)  return 0.5 + (fraction / 0.05) * 0.5; // near start – mild penalty
  if (fraction <= 0.80) return 1.0;                             // ideal zone
  return Math.max(0, 1 - (fraction - 0.80) / 0.20);            // near SCT – decay to 0
}

// Proximity score: how close is the pickup to the route?
// Uses a soft 2-km ceiling so distant passengers aren't completely zeroed out.
function proximityScore(distanceMeters) {
  return Math.max(0, 1 - distanceMeters / 2000);
}

// POST /api/match/find
router.post('/find', verifyToken, async (req, res) => {
  const { pickup_lat, pickup_lng, departure_time } = req.body;
  const SCT_LAT = 8.5241;
  const SCT_LNG = 76.9366;

  try {
    // ── Step 1: Broad candidate fetch ────────────────────────────────────────
    //
    // WHY this changed:
    // The old approach filtered by  ST_Distance(route_polyline, pickup_point) < 1500.
    // This fails when Nominatim gives an area centroid (e.g. "Karamana") that is
    // 2-3 km from the actual road the driver uses — even though the route DOES
    // pass through that area.
    //
    // New approach:
    //   1. Expand the driver's route bounding box by ~5 km on each side.
    //   2. Accept any route whose expanded box contains the passenger's pickup.
    //   3. Then compute the ACTUAL closest distance in Step 2 and use it for scoring.
    //
    // This ensures we never miss a geographically plausible ride.
    // The 5 km expansion (~0.045 degrees) is generous enough for any urban area;
    // false positives are pruned by the scoring step.
    //
    // We still keep a hard proximity cap (3 km in scoring) so truly irrelevant
    // rides don't surface.
    const BBOX_EXPAND_DEG = 0.045; // ≈ 5 km at 8° N latitude
    const HARD_PROXIMITY_CAP_M = 3000;

    const candidateResult = await pool.query(
      `SELECT
         r.*,
         u.name AS driver_name,
         -- Actual shortest road-network distance (meters) from pickup to route
         ST_Distance(
           r.route_polyline::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         ) AS pickup_distance_m,
         ST_Length(r.route_polyline::geography) AS original_route_m,
         -- Fraction (0–1) of where along the route the pickup point projects
         ST_LineLocatePoint(
           r.route_polyline::geometry,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geometry
         ) AS pickup_fraction,
         ST_X(ST_StartPoint(r.route_polyline::geometry)) AS start_lng,
         ST_Y(ST_StartPoint(r.route_polyline::geometry)) AS start_lat
       FROM rides r
       JOIN users u ON r.driver_id = u.id
       WHERE r.status = 'active'
         AND r.available_seats > 0
         -- Bounding-box pre-filter (uses spatial index — fast)
         AND ST_Expand(
               ST_Envelope(r.route_polyline::geometry),
               $3
             ) && ST_SetSRID(ST_MakePoint($1, $2), 4326)
         -- Hard cap: actual distance must be under 3 km
         AND ST_Distance(
               r.route_polyline::geography,
               ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
             ) < $4`,
      [pickup_lng, pickup_lat, BBOX_EXPAND_DEG, HARD_PROXIMITY_CAP_M]
    );

    if (candidateResult.rows.length === 0) {
      return res.json({
        matches: [],
        message: 'No rides found near your location. Try a nearby landmark or click on the map for a precise location.',
      });
    }

    const requestedTime = new Date(departure_time);

    // ── Step 2: Score every candidate ────────────────────────────────────────
    const scored = await Promise.all(candidateResult.rows.map(async (ride) => {
      const distM          = parseFloat(ride.pickup_distance_m);
      const origRouteM     = parseFloat(ride.original_route_m);
      const fraction       = parseFloat(ride.pickup_fraction);
      const driverStartLng = parseFloat(ride.start_lng);
      const driverStartLat = parseFloat(ride.start_lat);

      // A. Position score — is the pickup early enough in the route to be useful?
      const posScore = pickupPositionScore(fraction);

      // Hard-reject if driver is almost at SCT when passing the pickup
      if (posScore === 0) return null;

      // B. Proximity score
      const proxScore = proximityScore(distM);

      // C. Time score
      const timeDiffMins = Math.abs(new Date(ride.departure_time) - requestedTime) / 60000;
      const tScore = timeScore(timeDiffMins);

      // D. Detour score via ORS (proportional to driver's route, not fixed 2000 m)
      let dScore = proxScore; // fallback: use proximity as proxy if ORS fails
      let extraMeters = null;
      try {
        const detourORS = await callORS([
          [driverStartLng, driverStartLat],
          [pickup_lng, pickup_lat],
          [SCT_LNG, SCT_LAT],
        ]);
        const detourRouteM = detourORS.features[0].properties.summary.distance;
        extraMeters = Math.max(0, detourRouteM - origRouteM);
        dScore = detourScore(extraMeters, origRouteM);
      } catch (e) { /* ORS temporarily unavailable – fall back */ }

      // E. Weighted final score
      //   detour 40% — main cost to the driver
      //   position 25% — is pickup on the way, not at the end?
      //   time   20% — departure alignment
      //   proximity 15% — raw closeness to route
      const finalScore = Math.max(0, Math.min(1,
        dScore   * 0.40 +
        posScore * 0.25 +
        tScore   * 0.20 +
        proxScore * 0.15
      ));

      // F. Confidence label
      let cp = 0;
      if (extraMeters !== null)  cp++;
      if (!isNaN(fraction))      cp++;
      if (timeDiffMins <= 60)    cp++;
      if (distM < 500)           cp++;
      const confidence = cp >= 4 ? 'High' : cp >= 2 ? 'Medium' : 'Low';

      return {
        ride_id:                ride.id,
        driver_name:            ride.driver_name,
        start_location:         ride.start_location,
        end_location:           ride.end_location,
        departure_time:         ride.departure_time,
        available_seats:        ride.available_seats,
        pickup_distance_meters: Math.round(distM),
        detour_meters:          extraMeters !== null ? Math.round(extraMeters) : null,
        route_position_pct:     Math.round(fraction * 100),
        compatibility_score:    Math.round(finalScore * 100),
        confidence,
      };
    }));

    const matches = scored
      .filter(Boolean)
      .sort((a, b) => b.compatibility_score - a.compatibility_score);

    res.json({ matches });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
