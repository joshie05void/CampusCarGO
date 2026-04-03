// Fix existing rides: recompute route polylines to point to the REAL SCT (Pappanamcode)
const pool = require('./config/db');
const axios = require('axios');
require('dotenv').config();

const SCT = { lat: 8.4682, lng: 76.9829 };
const ORS_BASE = 'https://api.openrouteservice.org/v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fixRoutes() {
  const rides = await pool.query(
    `SELECT id, start_location,
            ST_Y(ST_StartPoint(route_polyline)) as start_lat,
            ST_X(ST_StartPoint(route_polyline)) as start_lng
     FROM rides WHERE status IN ('active', 'in_progress')`
  );

  console.log(`Found ${rides.rows.length} rides to fix.\n`);

  for (const r of rides.rows) {
    console.log(`Ride ${r.id} (${r.start_location}): start=[${r.start_lat}, ${r.start_lng}]`);
    try {
      const orsRes = await axios.post(
        `${ORS_BASE}/directions/driving-car/geojson`,
        { coordinates: [[parseFloat(r.start_lng), parseFloat(r.start_lat)], [SCT.lng, SCT.lat]] },
        { headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      const coords = orsRes.data.features[0].geometry.coordinates;
      const dist = orsRes.data.features[0].properties.summary.distance;
      const linestring = 'LINESTRING(' + coords.map(c => c[0] + ' ' + c[1]).join(',') + ')';

      await pool.query(
        `UPDATE rides SET route_polyline = ST_GeomFromText($1, 4326) WHERE id = $2`,
        [linestring, r.id]
      );
      console.log(`  ✓ Updated: ${Math.round(dist)}m, ${coords.length} points\n`);
      await sleep(300);
    } catch (e) {
      console.error(`  ✗ Failed: ${e.response?.data?.error?.message || e.message}\n`);
    }
  }

  console.log('Done! All active ride polylines now point to SCT Pappanamcode.');
  process.exit(0);
}

fixRoutes().catch(e => { console.error(e); process.exit(1); });
