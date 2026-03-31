const http = require('http');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const cron = require('node-cron');
const pool = require('./config/db');
const runMigrations = require('./db/migrate');
const { init: initSocket } = require('./socket');

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
const notifRoutes = require('./routes/notifications');
app.use('/api/notifications', notifRoutes);
const chatRoutes = require('./routes/chat');
app.use('/api/chat', chatRoutes);

app.get('/', (req, res) => {
  res.send('CampusCarGO backend is running');
});

// Run DB migrations on startup
runMigrations();

// ── Cron: every 10 minutes ───────────────────────────────────────────────────
// 1. Expire rides whose departure was more than 2 hours ago
// 2. Notify passengers of rides departing within 30 minutes
cron.schedule('*/10 * * * *', async () => {
  try {
    const expired = await pool.query(
      `UPDATE rides SET status = 'expired'
       WHERE status IN ('active', 'in_progress')
         AND departure_time < NOW() - INTERVAL '2 hours'
       RETURNING id`
    );
    if (expired.rows.length > 0) {
      console.log(`Cron: expired ${expired.rows.length} ride(s).`);
    }

    // Departure-soon notifications (within 30 min) — guard against duplicate notifs
    const upcoming = await pool.query(
      `SELECT r.id as ride_id, rr.passenger_id, r.start_location
       FROM rides r
       JOIN ride_requests rr ON rr.ride_id = r.id AND rr.status = 'accepted'
       WHERE r.status = 'active'
         AND r.departure_time BETWEEN NOW() AND NOW() + INTERVAL '30 minutes'
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.user_id = rr.passenger_id
             AND n.message LIKE '%departing soon%'
             AND n.created_at > NOW() - INTERVAL '1 hour'
         )`
    );
    for (const row of upcoming.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, message) VALUES ($1, $2)`,
        [row.passenger_id, `Your ride from ${row.start_location} is departing soon!`]
      );
    }
  } catch (err) {
    console.error('Cron error:', err.message);
  }
});

const server = http.createServer(app);
initSocket(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
