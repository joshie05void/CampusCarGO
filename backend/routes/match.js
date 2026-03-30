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
// This replaces the old linear decay that went to 0 at 3 km.
function proximityScore(distanceMeters) {
  return Math.exp(-distanceMeters / 4330); // ln(2)/4330 ≈ 0.00016 → half-life 3 km
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
    //
    // No ST_DWithin radius at all. Every active ride in the DB is a
    // candidate. The proximity score (exponential decay) handles the
    // distance penalty — far rides just score lower, they are never
    // hidden. Results are ordered nearest-first so the top 20 are the
    // most spatially relevant, but all rides are reachable in principle.
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
         ST_Y(ST_EndPoint(route_polyline)) AS end_lat,
         (SELECT ROUND(AVG(stars)::numeric, 1) FROM ratings WHERE ratee_id = rides.driver_id) AS driver_avg_rating
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
    //
    // These are hard constraints that make a ride fundamentally useless:
    //   a) Route must end within 2 km of SCT (correct destination)
    //   b) Driver must be going roughly toward SCT — not in the opposite
    //      direction (bearing difference > 90°). A backtracking ride is
    //      not a proximity problem, it's a route mismatch.
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
      // Exponential decay — half-life 3 km. No hard floor.
      // 0 m → 1.0 | 1 km → 0.79 | 3 km → 0.50 | 5 km → 0.32 | 10 km → 0.10 | 20 km → 0.01
      const proxScore = proximityScore(pickupDist);
      confidenceFactors.push('proximity'); // always computable

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

      // Distance label for UI (shows how far the route is from pickup)
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
        driver_avg_rating:     ride.driver_avg_rating ? parseFloat(ride.driver_avg_rating) : null,
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
