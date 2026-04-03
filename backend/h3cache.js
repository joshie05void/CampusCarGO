/**
 * H3 Spatial Index Cache
 * ──────────────────────
 * Converts driver route polylines into H3 hex-ID sets (Resolution 9, ~174m edges)
 * for O(1) geographic pre-filtering. Replaces the full PostGIS ST_Distance scan
 * that previously had to touch every active ride.
 *
 * At current CampusCarGO scale an in-memory Map is sufficient.
 * When concurrent drivers exceed ~500, migrate to Redis SET operations.
 */

const h3 = require('h3-js');

// Resolution 9 ≈ 174m edge length — good balance between precision and index size
const H3_RES = 9;

// In-memory store: rideId → Set<hexId>
const rideHexIndex = new Map();

/**
 * Index a ride's route polyline into H3 hexagons.
 * Call this when a driver posts a ride.
 *
 * @param {number} rideId
 * @param {Array<[number,number]>} coordinates  — Array of [lng, lat] pairs (ORS/GeoJSON order)
 */
function indexRide(rideId, coordinates) {
  if (!coordinates || coordinates.length === 0) return;

  const hexSet = new Set();

  for (const coord of coordinates) {
    const lng = coord[0];
    const lat = coord[1];
    const hex = h3.latLngToCell(lat, lng, H3_RES);
    hexSet.add(hex);

    // Also add immediate neighbors to cover the width of the road corridor
    // (a route polyline is a thin line; without neighbors a passenger 90m to
    //  the side might land in an adjacent hex and be missed)
    const neighbors = h3.gridDisk(hex, 1);
    for (const n of neighbors) hexSet.add(n);
  }

  rideHexIndex.set(rideId, hexSet);
  console.log(`[H3] Indexed ride ${rideId}: ${hexSet.size} hexagons`);
}

/**
 * Remove a ride from the spatial index.
 * Call on delete, complete, or expire.
 *
 * @param {number} rideId
 */
function removeRide(rideId) {
  rideHexIndex.delete(rideId);
}

/**
 * Find which ride IDs are spatially compatible with a passenger's location.
 * Returns the Set of ride IDs whose hex corridors intersect the passenger's hex neighborhood.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Set<number>}  ride IDs that pass the H3 pre-filter
 */
function findCandidateRides(lat, lng) {
  const passengerHex = h3.latLngToCell(lat, lng, H3_RES);
  // k-ring 1 = the passenger's hex + 6 immediate neighbors
  const passengerNeighborhood = new Set(h3.gridDisk(passengerHex, 1));

  const matchingRideIds = new Set();

  for (const [rideId, hexSet] of rideHexIndex) {
    for (const hex of passengerNeighborhood) {
      if (hexSet.has(hex)) {
        matchingRideIds.add(rideId);
        break; // one intersection is enough
      }
    }
  }

  return matchingRideIds;
}

/**
 * Bulk-load existing active rides from the database on server startup.
 * Fetches all active ride polylines and indexes them.
 *
 * @param {import('pg').Pool} pool
 */
async function warmCache(pool) {
  try {
    const result = await pool.query(
      `SELECT id, ST_AsGeoJSON(route_polyline) as geojson
       FROM rides
       WHERE status IN ('active', 'in_progress')
         AND route_polyline IS NOT NULL`
    );
    let count = 0;
    for (const row of result.rows) {
      if (row.geojson) {
        const geo = JSON.parse(row.geojson);
        if (geo.coordinates) {
          indexRide(row.id, geo.coordinates);
          count++;
        }
      }
    }
    console.log(`[H3] Cache warmed: ${count} active rides indexed`);
  } catch (err) {
    console.error('[H3] Cache warm failed:', err.message);
  }
}

/**
 * Check if we have H3 data for a given ride.
 * Used to decide whether to fall back to PostGIS.
 */
function hasRide(rideId) {
  return rideHexIndex.has(rideId);
}

/**
 * Get stats for debugging.
 */
function stats() {
  return {
    indexedRides: rideHexIndex.size,
    totalHexagons: Array.from(rideHexIndex.values()).reduce((sum, s) => sum + s.size, 0),
  };
}

module.exports = {
  indexRide,
  removeRide,
  findCandidateRides,
  warmCache,
  hasRide,
  stats,
  H3_RES,
};
