const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
const rideRoutes = require('./routes/rides');
app.use('/api/rides', rideRoutes);
const mapRoutes = require('./routes/maps');
app.use('/api/maps', mapRoutes);

app.get('/', (req, res) => {
  res.send('CampusCarGO backend is running');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
