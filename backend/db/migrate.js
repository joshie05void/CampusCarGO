const pool = require('../config/db');

async function runMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ratings (
        id SERIAL PRIMARY KEY,
        ride_id INTEGER REFERENCES rides(id),
        rater_id INTEGER REFERENCES users(id),
        ratee_id INTEGER REFERENCES users(id),
        stars INTEGER CHECK (stars BETWEEN 1 AND 5),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        message TEXT NOT NULL,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='ride_requests' AND column_name='score'
        ) THEN
          ALTER TABLE ride_requests ADD COLUMN score NUMERIC(5,2);
        END IF;
      END $$
    `);

    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='ride_requests' AND column_name='pickup_lat'
        ) THEN
          ALTER TABLE ride_requests ADD COLUMN pickup_lat NUMERIC(9,6);
        END IF;
      END $$
    `);

    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='ride_requests' AND column_name='pickup_lng'
        ) THEN
          ALTER TABLE ride_requests ADD COLUMN pickup_lng NUMERIC(9,6);
        END IF;
      END $$
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
        sender_id INTEGER REFERENCES users(id),
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('Migrations applied.');
  } catch (err) {
    console.error('Migration error:', err.message);
  }
}

module.exports = runMigrations;
