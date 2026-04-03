/**
 * CampusCarGO — Matching Engine v4.0 (Multiplicative, ETA-aware)
 *
 * Uses MULTIPLICATIVE scoring (geometric weighted mean) so that a bad
 * factor in ANY dimension tanks the entire score — not just its slice.
 *
 * score = 100 × (detourFactor ^ 0.45) × (timeFactor ^ 0.40) × (proximityFactor ^ 0.15)
 *
 * Detour: How much extra driving to pick up the passenger.
 *   Measured via pickup_distance (PostGIS ST_Distance to stored route polyline).
 *   Top candidates verified via ORS routing.
 *
 * Time: ETA-aware. Estimates WHEN the driver reaches the pickup area on the route,
 *   then compares with the passenger's requested departure time.
 *   Large gaps (driver waits or passenger waits) → heavy penalty.
 *
 * Proximity: Raw closeness of passenger to route. Gentle tiebreaker.
 */

const axios = require('axios');
require('dotenv').config();

const SCT = { lat: 8.4682, lng: 76.9829 }; // SCT College of Engineering, Pappanamcode

const ORS_BASE = 'https://api.openrouteservice.org/v2';
const ORS_KEY  = process.env.ORS_API_KEY;
const ORS_TIMEOUT = 8000;
const TVM_URBAN_SPEED_MS = 5.0; // 18 km/h
const ORS_ROUTING_LIMIT = 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Utilities ────────────────────────────────────────────────────────────────

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTrafficMultiplier(departureTime) {
  try {
    const dt = new Date(departureTime);
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(dt.getTime() + istOffset);
    const totalMin = istTime.getUTCHours() * 60 + istTime.getUTCMinutes();
    if (totalMin >= 450 && totalMin <= 570) return 1.3; // 7:30–9:30 AM
    if (totalMin >= 1020 && totalMin <= 1140) return 1.2; // 5–7 PM
  } catch (e) {}
  return 1.0;
}

async function getORSRoute(coordinates) {
  try {
    const res = await axios.post(
      `${ORS_BASE}/directions/driving-car/geojson`,
      { coordinates },
      { headers: { Authorization: ORS_KEY, 'Content-Type': 'application/json' }, timeout: ORS_TIMEOUT }
    );
    const s = res.data.features[0].properties.summary;
    return { distance: s.distance, duration: s.duration };
  } catch (e) { return null; }
}

// ── Scoring Functions ────────────────────────────────────────────────────────

/**
 * Detour score from estimated extra distance ratio.
 * exp(-3 × ratio): 0% → 1.0, 10% → 0.74, 20% → 0.54, 40% → 0.30
 */
function detourScore(extraMeters, baselineMeters, trafficMult) {
  if (baselineMeters <= 0) return 0.3;
  const ratio = (extraMeters * trafficMult) / baselineMeters;
  return Math.max(0.01, Math.exp(-3 * ratio));
}

/**
 * ETA-aware time score.
 * Sigmoid centered at 35 min gap: 0-15 min → ~1.0, 25 min → 0.73, 35 min → 0.50, 50 min → 0.18
 */
function timeScore(driverDeparture, passengerDeparture, routeFraction, routeLengthM) {
  const driveToPickupSec = (routeFraction || 0) * routeLengthM / TVM_URBAN_SPEED_MS;
  const driverEtaMs = new Date(driverDeparture).getTime() + (driveToPickupSec * 1000);
  const passengerMs = new Date(passengerDeparture).getTime();
  const gapMin = Math.abs(driverEtaMs - passengerMs) / 60000;
  return Math.max(0.01, 1 / (1 + Math.exp(0.15 * (gapMin - 35))));
}

/**
 * Proximity: exp decay, half-life ~2km.
 * 0m → 1.0, 500m → 0.82, 1km → 0.67, 2km → 0.45, 5km → 0.14
 */
function proximityScore(distMeters) {
  return Math.max(0.01, Math.exp(-distMeters / 2500));
}

// ── Labels ───────────────────────────────────────────────────────────────────

function timeLabel(gapMin) {
  if (gapMin < 5) return 'Same time';
  if (gapMin < 60) return `${Math.round(gapMin)} min apart`;
  return `${Math.round(gapMin / 60)}h+ apart`;
}
function detourLabel(m) {
  if (m == null) return 'Estimated';
  if (m < 200) return 'On route';
  if (m < 500) return 'Tiny detour';
  if (m < 1000) return 'Small detour';
  if (m < 2000) return 'Moderate detour';
  return `+${(m / 1000).toFixed(1)} km detour`;
}
function distLabel(d) {
  if (d < 200) return 'On route';
  if (d < 500) return 'Very close';
  if (d < 2000) return `${Math.round(d / 100) * 100}m away`;
  return `${(d / 1000).toFixed(1)} km away`;
}

// ── Core Engine ──────────────────────────────────────────────────────────────

async function findMatches({ pickupLat, pickupLng, dropoffLat, dropoffLng, departureTime, userId, pool }) {
  const meta = { version: '4.0', ors_calls: 0, ors_ok: 0, estimated: 0, traffic: 1.0, timing: {} };
  const t0 = Date.now();

  const q = await pool.query(
    `SELECT
       rides.*, users.name AS driver_name,
       ST_Distance(route_polyline::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS pickup_distance,
       ST_LineLocatePoint(route_polyline, ST_SetSRID(ST_MakePoint($1,$2),4326)) AS route_fraction,
       ST_Length(route_polyline::geography) AS route_length_m,
       ST_X(ST_StartPoint(route_polyline)) AS start_lng, ST_Y(ST_StartPoint(route_polyline)) AS start_lat,
       ST_X(ST_EndPoint(route_polyline)) AS end_lng, ST_Y(ST_EndPoint(route_polyline)) AS end_lat,
       (SELECT ROUND(AVG(stars)::numeric,1) FROM ratings WHERE ratee_id = rides.driver_id) AS driver_avg_rating
     FROM rides JOIN users ON rides.driver_id = users.id
     WHERE rides.status='active' AND rides.available_seats>0 AND rides.driver_id!=$3
     ORDER BY pickup_distance ASC LIMIT 30`,
    [pickupLng, pickupLat, userId]
  );
  meta.timing.fetchMs = Date.now() - t0;

  if (q.rows.length === 0) {
    return { matches: [], total_candidates: 0, message: 'No active rides found.', engine: meta };
  }

  const trafficMult = getTrafficMultiplier(departureTime);
  meta.traffic = trafficMult;
  const results = [];

  for (let i = 0; i < q.rows.length; i++) {
    const r = q.rows[i];
    const pickupDist = parseFloat(r.pickup_distance) || 0;
    const routeFrac = parseFloat(r.route_fraction) || 0;
    const routeLen = parseFloat(r.route_length_m) || 1;
    const sLat = parseFloat(r.start_lat), sLng = parseFloat(r.start_lng);
    // ── Detour calculation ──
    // Estimate: driver leaves route, goes to passenger, returns to route ≈ 2× pickup_distance × 1.3 road factor
    const extraM = pickupDist * 2 * 1.3;
    const extraS = extraM / TVM_URBAN_SPEED_MS;
    const method = 'estimate';
    meta.estimated++;

    // ── Compute 3 factors ──
    const ds = detourScore(extraM, routeLen, trafficMult);
    const ts = timeScore(r.departure_time, departureTime, routeFrac, routeLen);
    const ps = proximityScore(pickupDist);

    // ── Multiplicative weighted geometric mean ──
    // score = detour^0.45 × time^0.40 × proximity^0.15
    const raw = Math.pow(ds, 0.45) * Math.pow(ts, 0.40) * Math.pow(ps, 0.15);
    const score = Math.round(Math.max(1, Math.min(100, raw * 100)));

    // ETA gap for labels
    const driveToPickupSec = routeFrac * routeLen / TVM_URBAN_SPEED_MS;
    const etaMs = new Date(r.departure_time).getTime() + driveToPickupSec * 1000;
    const gapMin = Math.abs(etaMs - new Date(departureTime).getTime()) / 60000;

    let conf = 'low';
    if (ds > 0.5 && ts > 0.5 && ps > 0.5) conf = 'high';
    else if ((ds > 0.5 && ts > 0.3) || (ds > 0.3 && ts > 0.5)) conf = 'medium';

    results.push({
      ride_id: r.id, driver_name: r.driver_name,
      start_location: r.start_location, end_location: r.end_location,
      departure_time: r.departure_time, available_seats: r.available_seats,
      compatibility_score: score, confidence: conf,
      pickup_distance_meters: Math.round(pickupDist),
      distance_label: distLabel(pickupDist),
      detour_label: detourLabel(extraM),
      detour_extra_meters: Math.round(extraM),
      detour_extra_seconds: Math.round(extraS),
      detour_method: method,
      time_label: timeLabel(gapMin),
      time_diff_minutes: Math.round(gapMin),
      driver_avg_rating: r.driver_avg_rating ? parseFloat(r.driver_avg_rating) : null,
      score_breakdown: {
        detour: Math.round(ds * 100), time: Math.round(ts * 100),
        proximity: Math.round(ps * 100), traffic_multiplier: trafficMult,
        baseline_m: Math.round(routeLen), detour_extra_m: Math.round(extraM),
        eta_gap_min: Math.round(gapMin),
      },
      engine_version: '4.0',
    });
  }

  results.sort((a, b) => b.compatibility_score - a.compatibility_score);
  meta.timing.totalMs = Date.now() - t0;

  return {
    matches: results, total_candidates: q.rows.length,
    message: results.length > 0 ? `Found ${results.length} ride${results.length !== 1 ? 's' : ''} ranked by compatibility.` : 'No active rides found.',
    engine: meta,
  };
}

module.exports = { findMatches };
