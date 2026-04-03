// Debug script: check what PostGIS actually reports for known Trivandrum locations
const pool = require('./config/db');
require('dotenv').config();

const LOCATIONS = {
  karamana:     { lat: 8.4910, lng: 76.9583 },
  kaimanam:     { lat: 8.4782, lng: 76.9714 },
  ambalamukku:  { lat: 8.5310, lng: 76.9570 },
  kowdiar:      { lat: 8.5150, lng: 76.9500 },
  peroorkada:   { lat: 8.5430, lng: 76.9610 },
  thampanoor:   { lat: 8.4890, lng: 76.9503 },
  kudappanakunnu: { lat: 8.5550, lng: 76.9810 },
};

async function debug() {
  // 1. Show all active rides
  const rides = await pool.query(
    `SELECT id, driver_id, start_location, departure_time,
            ST_AsText(ST_StartPoint(route_polyline)) as start_pt,
            ST_AsText(ST_EndPoint(route_polyline)) as end_pt,
            ST_Length(route_polyline::geography) as route_length_m,
            ST_NPoints(route_polyline) as num_points
     FROM rides WHERE status='active'`
  );
  
  console.log('\n=== ACTIVE RIDES ===');
  for (const r of rides.rows) {
    console.log(`Ride ${r.id}: "${r.start_location}" | depart=${r.departure_time} | len=${Math.round(r.route_length_m)}m | pts=${r.num_points}`);
    console.log(`  start=${r.start_pt} end=${r.end_pt}`);
    
    // 2. For each ride, compute pickup_distance to all test locations
    console.log('  Pickup distances:');
    for (const [name, loc] of Object.entries(LOCATIONS)) {
      const dist = await pool.query(
        `SELECT 
           ST_Distance(route_polyline::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) as pickup_dist,
           ST_LineLocatePoint(route_polyline, ST_SetSRID(ST_MakePoint($1,$2),4326)) as route_fraction
         FROM rides WHERE id=$3`,
        [loc.lng, loc.lat, r.id]
      );
      const d = dist.rows[0];
      const pickupDist = Math.round(parseFloat(d.pickup_dist));
      const frac = parseFloat(d.route_fraction).toFixed(3);
      const detourEst = Math.round(pickupDist * 2 * 1.3);
      const ratio = (detourEst / parseFloat(r.route_length_m));
      const detourScore = Math.exp(-3 * ratio);
      console.log(`    ${name.padEnd(18)} pickup_dist=${pickupDist}m  frac=${frac}  est_detour=${detourEst}m  ratio=${ratio.toFixed(3)}  detour_score=${(detourScore*100).toFixed(0)}%`);
    }
  }
  
  process.exit(0);
}

debug().catch(e => { console.error(e); process.exit(1); });
