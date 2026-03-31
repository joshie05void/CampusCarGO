const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const { getIO } = require('../socket');

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

// Check user is driver of ride OR passenger with accepted request
async function canAccessChat(userId, rideId) {
  const result = await pool.query(
    `SELECT 1 FROM rides WHERE id = $1 AND driver_id = $2
     UNION
     SELECT 1 FROM ride_requests WHERE ride_id = $1 AND passenger_id = $2 AND status = 'accepted'`,
    [rideId, userId]
  );
  return result.rows.length > 0;
}

// GET /api/chat/:rideId — fetch messages for a ride
router.get('/:rideId', verifyToken, async (req, res) => {
  const rideId = parseInt(req.params.rideId);
  if (isNaN(rideId)) return res.status(400).json({ error: 'Invalid ride ID' });
  try {
    const allowed = await canAccessChat(req.user.id, rideId);
    if (!allowed) return res.status(403).json({ error: 'Not authorized for this chat' });

    const result = await pool.query(
      `SELECT m.id, m.message, m.created_at, u.name AS sender_name, u.id AS sender_id
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.ride_id = $1
       ORDER BY m.created_at ASC`,
      [rideId]
    );
    res.json({ messages: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/:rideId — send a message
router.post('/:rideId', verifyToken, async (req, res) => {
  const rideId = parseInt(req.params.rideId);
  if (isNaN(rideId)) return res.status(400).json({ error: 'Invalid ride ID' });
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message cannot be empty' });

  try {
    const allowed = await canAccessChat(req.user.id, rideId);
    if (!allowed) return res.status(403).json({ error: 'Not authorized for this chat' });

    const ins = await pool.query(
      `INSERT INTO messages (ride_id, sender_id, message) VALUES ($1, $2, $3)
       RETURNING id, message, created_at`,
      [rideId, req.user.id, message.trim()]
    );
    const userRes = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
    const outMsg = {
      ...ins.rows[0],
      sender_id: req.user.id,
      sender_name: userRes.rows[0].name,
    };

    // Broadcast to everyone in the ride room (including sender for consistency)
    getIO().to(`ride_${rideId}`).emit('new_message', outMsg);

    res.json({ message: outMsg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
