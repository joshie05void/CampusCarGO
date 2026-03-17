import { useState, useEffect } from 'react';
import axios from 'axios';

function Dashboard({ token, role }) {
  const [rides, setRides] = useState([]);
  const [message, setMessage] = useState('');

  // Driver state
  const [startLocation, setStartLocation] = useState('');
  const [endLocation, setEndLocation] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [seats, setSeats] = useState(1);
  const [startLng, setStartLng] = useState('');
  const [startLat, setStartLat] = useState('');
  const [endLng, setEndLng] = useState('');
  const [endLat, setEndLat] = useState('');

  // Passenger state
  const [pickupLat, setPickupLat] = useState('');
  const [pickupLng, setPickupLng] = useState('');
  const [dropoffLat, setDropoffLat] = useState('');
  const [dropoffLng, setDropoffLng] = useState('');
  const [matchTime, setMatchTime] = useState('');
  const [matches, setMatches] = useState([]);

  const headers = { Authorization: token };

  const postRide = async () => {
    try {
      const res = await axios.post('http://localhost:5000/api/rides/post', {
        start_location: startLocation,
        end_location: endLocation,
        departure_time: departureTime,
        available_seats: seats,
        start_lng: parseFloat(startLng),
        start_lat: parseFloat(startLat),
        end_lng: parseFloat(endLng),
        end_lat: parseFloat(endLat)
      }, { headers });
      setMessage('Ride posted! ID: ' + res.data.ride.id);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Error posting ride');
    }
  };

  const findMatches = async () => {
    try {
      const res = await axios.post('http://localhost:5000/api/match/find', {
        pickup_lat: parseFloat(pickupLat),
        pickup_lng: parseFloat(pickupLng),
        dropoff_lat: parseFloat(dropoffLat),
        dropoff_lng: parseFloat(dropoffLng),
        departure_time: matchTime
      }, { headers });
      setMatches(res.data.matches);
      if (res.data.matches.length === 0) setMessage('No matches found');
    } catch (err) {
      setMessage(err.response?.data?.error || 'Error finding matches');
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px' }}>
      <h2 style={{ textAlign: 'center' }}>CampusCarGO — {role === 'driver' ? 'Driver' : 'Passenger'} Dashboard</h2>

      {role === 'driver' && (
        <div style={{ border: '1px solid #ccc', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
          <h3>Post a Ride</h3>
          <input placeholder="Start Location (name)" value={startLocation} onChange={e => setStartLocation(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="End Location (name)" value={endLocation} onChange={e => setEndLocation(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="Start Latitude (e.g. 8.5467)" value={startLat} onChange={e => setStartLat(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="Start Longitude (e.g. 76.9312)" value={startLng} onChange={e => setStartLng(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="End Latitude (e.g. 8.5553)" value={endLat} onChange={e => setEndLat(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="End Longitude (e.g. 76.9499)" value={endLng} onChange={e => setEndLng(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="Departure Time" type="datetime-local" value={departureTime} onChange={e => setDepartureTime(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="Available Seats" type="number" value={seats} onChange={e => setSeats(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <button onClick={postRide} style={{ width: '100%', padding: '10px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Post Ride</button>
        </div>
      )}

      {role === 'passenger' && (
        <div style={{ border: '1px solid #ccc', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
          <h3>Find a Ride</h3>
          <input placeholder="Pickup Latitude (e.g. 8.5480)" value={pickupLat} onChange={e => setPickupLat(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="Pickup Longitude (e.g. 76.9320)" value={pickupLng} onChange={e => setPickupLng(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="Dropoff Latitude (e.g. 8.5553)" value={dropoffLat} onChange={e => setDropoffLat(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="Dropoff Longitude (e.g. 76.9499)" value={dropoffLng} onChange={e => setDropoffLng(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <input placeholder="Departure Time" type="datetime-local" value={matchTime} onChange={e => setMatchTime(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box' }} />
          <button onClick={findMatches} style={{ width: '100%', padding: '10px', background: '#2196F3', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Find Matches</button>

          {matches.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <h4>Matched Rides</h4>
              {matches.map(match => (
                <div key={match.ride_id} style={{ border: '1px solid #ddd', padding: '10px', marginBottom: '10px', borderRadius: '4px' }}>
                  <p><strong>Driver:</strong> {match.driver_name}</p>
                  <p><strong>Route:</strong> {match.start_location} → {match.end_location}</p>
                  <p><strong>Departure:</strong> {new Date(match.departure_time).toLocaleString()}</p>
                  <p><strong>Seats:</strong> {match.available_seats}</p>
                  <p><strong>Pickup Distance:</strong> {match.pickup_distance_meters}m from your location</p>
                  <p><strong>Compatibility Score:</strong> {match.compatibility_score}%</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {message && <p style={{ color: 'green', textAlign: 'center' }}>{message}</p>}
    </div>
  );
}

export default Dashboard;