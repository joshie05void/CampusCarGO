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

// Haversine distance in meters
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Bearing between two points in degrees (0–360)
function bearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Angular difference (0–180)
function angleDiff(a, b) {
  let diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Sigmoid time score — flat near 0 min, steep drop around 30 min, near 0 beyond 50 min
function sigmoidTimeScore(diffMinutes) {
  return 1 / (1 + Math.exp(0.15 * (diffMinutes - 30)));
}

// Call ORS for a multi-waypoint route and return total distance in meters
async function getORSRouteDistance(coordinates) {
  try {
    const response = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      { coordinates },
      {
        headers: {
          Authorization: process.env.ORS_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );
    return response.data.features[0].properties.summary.distance;
  } catch (err) {
    return null; // graceful fallback — caller handles null
  }
}

// Sleep helper for rate limiting ORS calls
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


// ═══════════════════════════════════════════════
//  SCORING WEIGHTS
// ═══════════════════════════════════════════════
const WEIGHTS = {
  detour:    0.40,   // how much extra the driver would drive
  position:  0.25,   // where on the route the pickup falls
  time:      0.20,   // departure time compatibility
  proximity: 0.15    // raw distance from pickup to route
};

// SCT Pappanamcode — fixed destination
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
    // STEP 1 — Broad candidate fetch (3 km radius)
    //
    // Uses PostGIS ST_DWithin for efficient spatial search.
    // Also fetches geometry data we need for scoring:
    //   • pickup_distance  — meters from pickup to nearest point on route
    //   • route_fraction   — 0.0 (start) to 1.0 (end) where pickup projects
    //   • closest point    — the actual lat/lng on the route nearest to pickup
    //   • route length     — total route distance in meters
    //   • route start/end  — for direction alignment check
    // ──────────────────────────────────────────
    const candidateQuery = await pool.query(
      `SELECT
         rides.*,
         users.name AS driver_name,
         -- Distance from pickup to nearest point on route (meters)
         ST_Distance(
           route_polyline::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         ) AS pickup_distance,
         -- Fraction along route where pickup projects (0 = start, 1 = end)
         ST_LineLocatePoint(
           route_polyline,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)
         ) AS route_fraction,
         -- Closest point on route to the pickup
         ST_X(ST_ClosestPoint(route_polyline, ST_SetSRID(ST_MakePoint($1, $2), 4326))) AS closest_lng,
         ST_Y(ST_ClosestPoint(route_polyline, ST_SetSRID(ST_MakePoint($1, $2), 4326))) AS closest_lat,
         -- Total route length in meters
         ST_Length(route_polyline::geography) AS route_length_m,
         -- Route start point
         ST_X(ST_StartPoint(route_polyline)) AS start_lng,
         ST_Y(ST_StartPoint(route_polyline)) AS start_lat,
         -- Route end point
         ST_X(ST_EndPoint(route_polyline)) AS end_lng,
         ST_Y(ST_EndPoint(route_polyline)) AS end_lat
       FROM rides
       JOIN users ON rides.driver_id = users.id
       WHERE rides.status = 'active'
         AND rides.available_seats > 0
         AND rides.driver_id != $3
         AND ST_DWithin(
           route_polyline::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           3000
         )
       ORDER BY pickup_distance ASC
       LIMIT 20`,
      [pickup_lng, pickup_lat, req.user.id]
    );

    if (candidateQuery.rows.length === 0) {
      return res.json({
        matches: [],
        total_candidates: 0,
        message: 'No rides found within 3 km of your pickup location.'
      });
    }

    // ──────────────────────────────────────────
    // STEP 2 — Pre-filter: direction & dropoff
    //
    // Fast checks that eliminate clearly wrong rides before
    // we spend ORS calls on them:
    //   a) Route endpoint must be within 2 km of SCT
    //   b) Driver's overall bearing must roughly align with
    //      the passenger's pickup→dropoff bearing (< 90°)
    // ──────────────────────────────────────────
    let candidates = candidateQuery.rows.filter(ride => {
      // (a) Dropoff verification — route must end near SCT
      const endToSCT = haversine(
        parseFloat(ride.end_lat), parseFloat(ride.end_lng),
        SCT.lat, SCT.lng
      );
      if (endToSCT > 2000) return false;

      // (b) Direction alignment
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
        message: 'Rides were found nearby but none are heading in your direction.'
      });
    }

    // Take top 10 by proximity for detailed scoring (limits ORS calls)
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
      //
      // The most important factor. Calls ORS to compute:
      //   original route:  driver start → SCT
      //   detour route:    driver start → passenger pickup → SCT
      //   extra distance = detour - original
      //
      // Example: Peroorkada→SCT is 7.2 km via Sasthamangalam.
      //          Peroorkada→Pattom→SCT is 9.1 km.
      //          Detour ratio = (9.1-7.2)/7.2 = 26% → low score
      //
      // Falls back to proximity-based estimate if ORS unavailable.
      // ─────────────────────────────────────────
      let detourScore = null;
      let detourExtraMeters = null;
      let detourPercent = null;

      try {
        const startCoord = [parseFloat(ride.start_lng), parseFloat(ride.start_lat)];
        const endCoord = [parseFloat(ride.end_lng), parseFloat(ride.end_lat)];
        const pickupCoord = [pickup_lng, pickup_lat];

        // Use PostGIS route length as the original distance
        const originalDistance = routeLength;

        // ORS call: route via pickup
        const detourDistance = await getORSRouteDistance([startCoord, pickupCoord, endCoord]);

        if (detourDistance !== null && originalDistance > 0) {
          const extraDistance = Math.max(0, detourDistance - originalDistance);
          detourExtraMeters = Math.round(extraDistance);
          const detourRatio = extraDistance / originalDistance;
          detourPercent = Math.round(detourRatio * 100);

          // Score: 1.0 = no detour, 0.0 at 20%+ detour
          // Linear decay: every 1% detour loses 5% score
          detourScore = Math.max(0, Math.min(1, 1 - detourRatio * 5));
          confidenceFactors.push('detour');
        }

        // Rate limit: 250ms between ORS calls
        await sleep(250);
      } catch (err) {
        // ORS failed — handled below with fallback
      }

      // Fallback: approximate detour from straight-line pickup distance
      if (detourScore === null) {
        // Rough heuristic: if pickup is 500m from route, assume ~1km detour
        const estimatedDetour = pickupDist * 2;
        const estimatedRatio = routeLength > 0 ? estimatedDetour / routeLength : 1;
        detourScore = Math.max(0, Math.min(1, 1 - estimatedRatio * 5));
        detourExtraMeters = Math.round(estimatedDetour);
        detourPercent = Math.round(estimatedRatio * 100);
      }

      // ── FACTOR 2: Pickup Position on Route (25%) ──
      //
      // Where the pickup falls along the driver's route.
      // Early pickup (fraction < 0.3) = great, driver hasn't gone far yet.
      // Mid pickup (0.3–0.6) = good.
      // Late pickup (0.6–0.8) = penalized, driver is close to SCT.
      // Very late (> 0.8) = heavily penalized, almost pointless.
      // ─────────────────────────────────────────
      let positionScore;
      let positionLabel;

      if (isNaN(routeFraction)) {
        positionScore = 0.5; // unknown, neutral
        positionLabel = 'Unknown';
      } else if (routeFraction < 0.3) {
        positionScore = 1.0;
        positionLabel = 'Early on route';
        confidenceFactors.push('position');
      } else if (routeFraction < 0.6) {
        positionScore = 0.85;
        positionLabel = 'Mid route';
        confidenceFactors.push('position');
      } else if (routeFraction < 0.8) {
        // Gradual decay from 0.6 to 0.3
        positionScore = 0.6 - (routeFraction - 0.6) * 1.5;
        positionLabel = 'Late on route';
        confidenceFactors.push('position');
      } else {
        // Sharp penalty — driver is almost at SCT
        positionScore = Math.max(0.05, 0.3 - (routeFraction - 0.8) * 1.5);
        positionLabel = 'Near destination';
        confidenceFactors.push('position');
      }

      // ── FACTOR 3: Time Compatibility (20%) ──
      //
      // Sigmoid curve centered at 30 minutes:
      //   0–10 min → score ~1.0  (perfect)
      //   20 min   → score ~0.82
      //   30 min   → score ~0.50
      //   45 min   → score ~0.09
      //   60+ min  → score ~0.01
      // ─────────────────────────────────────────
      const rideTime = new Date(ride.departure_time).getTime();
      const requestedTime = new Date(departure_time).getTime();
      const timeDiffMin = Math.abs(rideTime - requestedTime) / 60000;
      const timeScore = sigmoidTimeScore(timeDiffMin);

      if (timeDiffMin <= 120) confidenceFactors.push('time');

      // ── FACTOR 4: Proximity to Route (15%) ──
      //
      // How far the pickup is from the driver's route.
      // Linear decay from 0m (score 1.0) to 3000m (score 0.0).
      // ─────────────────────────────────────────
      const proximityScore = Math.max(0, 1 - (pickupDist / 3000));
      if (pickupDist <= 3000) confidenceFactors.push('proximity');

      // ── WEIGHTED FINAL SCORE ──
      const finalScore =
        (detourScore * WEIGHTS.detour) +
        (positionScore * WEIGHTS.position) +
        (timeScore * WEIGHTS.time) +
        (proximityScore * WEIGHTS.proximity);

      // ── CONFIDENCE LABEL ──
      // Based on how many factors were reliably computed
      let confidence;
      if (confidenceFactors.length >= 4) confidence = 'high';
      else if (confidenceFactors.length >= 3) confidence = 'medium';
      else confidence = 'low';

      // ── TIME LABEL (human-friendly) ──
      let timeLabel;
      if (timeDiffMin < 5) timeLabel = 'Same time';
      else if (timeDiffMin < 60) timeLabel = `${Math.round(timeDiffMin)} min apart`;
      else timeLabel = `${Math.round(timeDiffMin / 60)}h+ apart`;

      // ── DETOUR LABEL ──
      let detourLabel;
      if (detourExtraMeters === null || detourExtraMeters === 0) {
        detourLabel = 'On route';
      } else if (detourExtraMeters < 500) {
        detourLabel = 'Minimal detour';
      } else {
        detourLabel = `+${(detourExtraMeters / 1000).toFixed(1)} km detour`;
      }

      scoredResults.push({
        ride_id: ride.id,
        driver_name: ride.driver_name,
        start_location: ride.start_location,
        end_location: ride.end_location,
        departure_time: ride.departure_time,
        available_seats: ride.available_seats,

        // Overall match
        compatibility_score: Math.round(finalScore * 100),
        confidence,

        // Human-readable labels for frontend
        pickup_distance_meters: Math.round(pickupDist),
        detour_label: detourLabel,
        detour_extra_meters: detourExtraMeters,
        position_label: positionLabel,
        time_label: timeLabel,
        time_diff_minutes: Math.round(timeDiffMin),

        // Detailed breakdown (for tooltip or debug)
        score_breakdown: {
          detour: Math.round(detourScore * 100),
          position: Math.round(positionScore * 100),
          time: Math.round(timeScore * 100),
          proximity: Math.round(proximityScore * 100)
        }
      });
    }

    // ──────────────────────────────────────────
    // STEP 4 — Sort & filter
    // ──────────────────────────────────────────
    scoredResults.sort((a, b) => b.compatibility_score - a.compatibility_score);

    // Remove matches below 15% — essentially useless
    const filtered = scoredResults.filter(m => m.compatibility_score >= 15);

    res.json({
      matches: filtered,
      total_candidates: candidateQuery.rows.length,
      message: filtered.length === 0
        ? 'Rides were found nearby but none are a good match for your route and timing.'
        : `Found ${filtered.length} compatible ride${filtered.length > 1 ? 's' : ''}.`
    });

  } catch (err) {
    console.error('Match error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
