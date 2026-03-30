const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const jwt = require('jsonwebtoken');

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

// GET /api/notifications — recent notifications for current user
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    const unread_count = result.rows.filter(n => !n.read).length;
    res.json({ notifications: result.rows, unread_count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/read — mark all as read
router.post('/read', verifyToken, async (req, res) => {
  try {
    await pool.query(`UPDATE notifications SET read = TRUE WHERE user_id = $1`, [req.user.id]);
    res.json({ message: 'All notifications marked as read.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
