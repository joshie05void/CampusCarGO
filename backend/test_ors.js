const axios = require('axios');
require('dotenv').config();
const ORS_BASE = 'https://api.openrouteservice.org/v2';
const ORS_KEY = process.env.ORS_API_KEY;

async function testORS() {
  try {
    const res = await axios.post(`${ORS_BASE}/directions/driving-car/geojson`, 
      { coordinates: [[76.961, 8.543], [76.961, 8.543], [76.9829, 8.4682]] }, 
      { headers: { Authorization: ORS_KEY, 'Content-Type': 'application/json' } }
    );
    console.log('SUCCESS');
  } catch(e) { console.error('ORS ERROR:', e.response?.data?.error || e.message); }
}
testORS();
