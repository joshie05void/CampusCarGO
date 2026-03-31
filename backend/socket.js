const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let _io = null;

// In-memory: driverId → { lat, lng, rideId, updatedAt }
const driverLocations = new Map();

function init(server) {
  _io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  _io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token provided'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  _io.on('connection', (socket) => {
    // Personal room — used for targeted events (request accepted, ride completed)
    socket.join(`user_${socket.user.id}`);

    socket.on('join_ride', (rideId) => {
      socket.join(`ride_${rideId}`);
    });

    socket.on('leave_ride', (rideId) => {
      socket.leave(`ride_${rideId}`);
    });

    // Driver broadcasts live GPS position
    socket.on('driver:location', ({ lat, lng, rideId }) => {
      if (lat == null || lng == null || !rideId) return;
      driverLocations.set(socket.user.id, { lat, lng, rideId, updatedAt: Date.now() });

      // Live tracking: send to passengers who joined the ride room
      _io.to(`ride_${rideId}`).emit('driver:location_update', { lat, lng, rideId });

      // Pre-match map: send to passengers subscribed to watching_drivers
      _io.to('watching_drivers').emit('active_drivers_update', {
        driverId: socket.user.id, lat, lng, rideId,
      });
    });

    // Passenger subscribes to active driver positions (for pre-match map)
    socket.on('watch_drivers', () => {
      socket.join('watching_drivers');
    });

    socket.on('unwatch_drivers', () => {
      socket.leave('watching_drivers');
    });

    // Passenger requests snapshot of all currently active driver positions
    socket.on('get_active_drivers', () => {
      const now = Date.now();
      const drivers = [];
      driverLocations.forEach((val, driverId) => {
        if (now - val.updatedAt < 5 * 60 * 1000) {
          drivers.push({ driverId, ...val });
        }
      });
      socket.emit('active_drivers', drivers);
    });

    socket.on('disconnect', () => {
      driverLocations.delete(socket.user.id);
    });
  });

  return _io;
}

function getIO() {
  if (!_io) throw new Error('Socket.IO not initialized');
  return _io;
}

module.exports = { init, getIO };
