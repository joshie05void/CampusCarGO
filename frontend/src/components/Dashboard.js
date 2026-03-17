import { useState, useEffect } from 'react';
import axios from 'axios';
import MapPicker from './MapPicker';

export default function Dashboard({ token, role, onLogout }) {
  const [pickupLocation, setPickupLocation] = useState(null);
  const [departureTime, setDepartureTime] = useState('');
  const [seats, setSeats] = useState(1);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState([]);
const [myStatus, setMyStatus] = useState([]);
const [myRides, setMyRides] = useState([]);

  const SCT = { lat: 8.5241, lng: 76.9366, name: 'SCT Pappanamcode' };

  const showMessage = (msg, type = 'success') => {
    setMessage(msg);
    setMessageType(type);
  };

  useEffect(() => {
    if (role === 'driver') { fetchRequests(); fetchMyRides(); }
    if (role === 'passenger') fetchMyStatus();
  }, []);

  const fetchRequests = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/requests', {
        headers: { Authorization: token }
      });
      setRequests(res.data.requests);
    } catch (err) { console.error(err); }
  };

  const fetchMyRides = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/myrides', {
        headers: { Authorization: token }
      });
      setMyRides(res.data.rides);
    } catch (err) { console.error(err); }
  };

  const handleDeleteRide = async (rideId) => {
    if (!window.confirm('Delete this ride?')) return;
    try {
      await axios.delete(`http://localhost:5000/api/rides/delete/${rideId}`, {
        headers: { Authorization: token }
      });
      showMessage('Ride deleted.', 'success');
      fetchMyRides();
    } catch (err) {
      showMessage(err.response?.data?.error || 'Error deleting ride', 'error');
    }
  };

  const fetchMyStatus = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/mystatus', {
        headers: { Authorization: token }
      });
      setMyStatus(res.data.requests);
    } catch (err) { console.error(err); }
  };

  const handlePostRide = async () => {
    if (!pickupLocation) { showMessage('Please select a start location.', 'error'); return; }
    if (!departureTime) { showMessage('Please select a departure time.', 'error'); return; }
    setLoading(true);
    try {
      await axios.post('http://localhost:5000/api/rides/post', {
        start_location: pickupLocation.name,
        end_location: SCT.name,
        departure_time: departureTime,
        available_seats: seats,
        start_lat: pickupLocation.lat,
        start_lng: pickupLocation.lng,
        end_lat: SCT.lat,
        end_lng: SCT.lng
      }, { headers: { Authorization: token } });
      showMessage('Ride posted successfully.', 'success');
    } catch (err) {
      showMessage(err.response?.data?.error || 'Error posting ride', 'error');
    }
    setLoading(false);
  };

  const handleFindRides = async () => {
    if (!pickupLocation) { showMessage('Please select your pickup location.', 'error'); return; }
    if (!departureTime) { showMessage('Please select a departure time.', 'error'); return; }
    setLoading(true);
    try {
      const res = await axios.post('http://localhost:5000/api/match/find', {
        pickup_lat: pickupLocation.lat,
        pickup_lng: pickupLocation.lng,
        dropoff_lat: SCT.lat,
        dropoff_lng: SCT.lng,
        departure_time: departureTime
      }, { headers: { Authorization: token } });
      setMatches(res.data.matches);
      if (res.data.matches.length === 0) showMessage('No rides found near your location.', 'error');
      else setMessage('');
    } catch (err) {
      showMessage(err.response?.data?.error || 'Error finding rides', 'error');
    }
    setLoading(false);
  };

  const handleRequestRide = async (rideId) => {
    if (!pickupLocation) return;
    try {
      await axios.post('http://localhost:5000/api/rides/request', {
        ride_id: rideId,
        pickup_location: pickupLocation.name,
        dropoff_location: SCT.name
      }, { headers: { Authorization: token } });
      showMessage('Ride requested. Waiting for driver confirmation.', 'success');
      fetchMyStatus();
    } catch (err) {
      showMessage(err.response?.data?.error || 'Error requesting ride', 'error');
    }
  };

  const handleRespond = async (requestId, action) => {
    try {
      await axios.post('http://localhost:5000/api/rides/respond', {
        request_id: requestId,
        action
      }, { headers: { Authorization: token } });
      showMessage(`Request ${action}.`, 'success');
      fetchRequests();
    } catch (err) {
      showMessage(err.response?.data?.error || 'Error responding', 'error');
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '15px',
    outline: 'none',
    background: 'white',
    color: '#1a1a1a'
  };

  const labelStyle = {
    display: 'block',
    fontSize: '13px',
    color: '#888',
    marginBottom: '6px'
  };

  const statusBadge = (status) => {
    const map = {
      accepted: { bg: '#f0faf5', color: '#27ae60', text: 'Accepted' },
      rejected: { bg: '#fdf3f2', color: '#c0392b', text: 'Rejected' },
      pending:  { bg: '#fdf9f0', color: '#e67e22', text: 'Pending' }
    };
    const s = map[status] || map.pending;
    return (
      <span style={{
        background: s.bg, color: s.color,
        padding: '4px 10px', borderRadius: '4px',
        fontSize: '13px', fontWeight: '600'
      }}>{s.text}</span>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f9f9f9' }}>

      {/* Navbar */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e8e8e8',
        padding: '0 24px',
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ fontWeight: '700', fontSize: '17px', color: '#1a1a1a' }}>
          CampusCarGO
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '13px', color: '#888' }}>
            {role === 'driver' ? 'Driver' : 'Passenger'}
          </span>
          <button onClick={onLogout} style={{
            padding: '7px 14px',
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '500',
            color: '#1a1a1a'
          }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 20px' }}>

        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a1a' }}>
            {role === 'driver' ? 'Post a ride' : 'Find a ride'}
          </h1>
          <p style={{ color: '#888', marginTop: '4px', fontSize: '14px' }}>
            {role === 'driver'
              ? 'Share your route to SCT and pick up passengers along the way.'
              : 'Find a driver heading to SCT near your location.'}
          </p>
        </div>

        {/* Form */}
        <div style={{
          background: 'white',
          border: '1px solid #e8e8e8',
          borderRadius: '10px',
          padding: '24px',
          marginBottom: '24px'
        }}>
          <MapPicker
            label={role === 'driver' ? 'Start location' : 'Pickup location'}
            onLocationSelect={setPickupLocation}
          />

          {/* Destination */}
          <div style={{ marginBottom: '18px' }}>
            <label style={labelStyle}>Destination</label>
            <div style={{
              padding: '10px 12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '15px',
              color: '#888',
              background: '#fafafa',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span>SCT Pappanamcode</span>
              <span style={{ fontSize: '12px', color: '#aaa' }}>fixed</span>
            </div>
          </div>

          {/* Departure time */}
          <div style={{ marginBottom: '18px' }}>
            <label style={labelStyle}>Departure time</label>
            <input
              type="datetime-local"
              value={departureTime}
              onChange={e => setDepartureTime(e.target.value)}
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = '#1a1a1a'}
              onBlur={e => e.target.style.borderColor = '#ddd'}
            />
          </div>

          {/* Seats */}
          {role === 'driver' && (
            <div style={{ marginBottom: '18px' }}>
              <label style={labelStyle}>Available seats</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <button key={n} onClick={() => setSeats(n)} style={{
                    width: '40px', height: '40px',
                    border: `1px solid ${seats === n ? '#1a1a1a' : '#ddd'}`,
                    borderRadius: '6px',
                    background: seats === n ? '#1a1a1a' : 'white',
                    color: seats === n ? 'white' : '#888',
                    fontWeight: '600',
                    fontSize: '15px'
                  }}>{n}</button>
                ))}
              </div>
            </div>
          )}

          {/* Message */}
          {message && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '6px',
              marginBottom: '14px',
              fontSize: '14px',
              background: messageType === 'success' ? '#f0faf5' : '#fdf3f2',
              border: `1px solid ${messageType === 'success' ? '#b7e4c7' : '#f5c6c2'}`,
              color: messageType === 'success' ? '#27ae60' : '#c0392b'
            }}>
              {message}
            </div>
          )}

          <button
            onClick={role === 'driver' ? handlePostRide : handleFindRides}
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px',
              background: loading ? '#999' : '#1a1a1a',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '15px',
              fontWeight: '600'
            }}>
            {loading ? 'Please wait...' : role === 'driver' ? 'Post ride' : 'Find rides'}
          </button>
        </div>

{/* Driver: My Posted Rides */}
        {role === 'driver' && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: '600', color: '#1a1a1a' }}>
                My posted rides {myRides.length > 0 && <span style={{ color: '#888', fontWeight: '400', fontSize: '14px' }}>({myRides.length})</span>}
              </h2>
              <button onClick={fetchMyRides} style={{
                padding: '6px 12px', background: 'white', border: '1px solid #ddd',
                borderRadius: '6px', fontSize: '13px', color: '#888'
              }}>Refresh</button>
            </div>

            {myRides.length === 0 ? (
              <div style={{
                background: 'white', border: '1px solid #e8e8e8', borderRadius: '10px',
                padding: '24px', textAlign: 'center', color: '#bbb', fontSize: '14px'
              }}>No rides posted yet.</div>
            ) : myRides.map((r, i) => (
              <div key={i} style={{
                background: 'white', border: '1px solid #e8e8e8', borderRadius: '10px',
                padding: '18px', marginBottom: '10px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '15px' }}>{r.start_location} → SCT</div>
                  <div style={{ color: '#888', fontSize: '13px', marginTop: '2px' }}>
                    {new Date(r.departure_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  <div style={{ color: '#bbb', fontSize: '13px', marginTop: '2px' }}>
                    {r.available_seats} seat{r.available_seats !== 1 ? 's' : ''} · {r.status}
                  </div>
                </div>
                <button onClick={() => handleDeleteRide(r.id)} style={{
                  padding: '7px 14px', background: 'white', color: '#c0392b',
                  border: '1px solid #f5c6c2', borderRadius: '6px',
                  fontSize: '13px', fontWeight: '500'
                }}>Delete</button>
              </div>
            ))}
          </div>
        )}

        
        {/* Driver: Incoming Requests */}
        {role === 'driver' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '600', color: '#1a1a1a' }}>
                Incoming requests
                {requests.length > 0 && (
                  <span style={{
                    marginLeft: '8px', background: '#1a1a1a', color: 'white',
                    fontSize: '12px', padding: '2px 7px', borderRadius: '10px'
                  }}>{requests.length}</span>
                )}
              </div>
              <button onClick={fetchRequests} style={{
                padding: '6px 12px', background: 'white',
                border: '1px solid #ddd', borderRadius: '6px',
                fontSize: '13px', color: '#888'
              }}>Refresh</button>
            </div>

            {requests.length === 0 ? (
              <div style={{
                background: 'white', border: '1px solid #e8e8e8',
                borderRadius: '10px', padding: '24px',
                textAlign: 'center', color: '#aaa', fontSize: '14px'
              }}>
                No pending requests.
              </div>
            ) : (
              requests.map((r, i) => (
                <div key={i} style={{
                  background: 'white', border: '1px solid #e8e8e8',
                  borderRadius: '10px', padding: '18px', marginBottom: '10px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '15px' }}>{r.passenger_name}</div>
                      <div style={{ color: '#888', fontSize: '13px', marginTop: '2px' }}>Pickup: {r.pickup_location}</div>
                      <div style={{ color: '#aaa', fontSize: '13px' }}>
                        {new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button onClick={() => handleRespond(r.id, 'accepted')} style={{
                      padding: '9px', background: '#1a1a1a', color: 'white',
                      border: 'none', borderRadius: '6px', fontWeight: '600', fontSize: '14px'
                    }}>Accept</button>
                    <button onClick={() => handleRespond(r.id, 'rejected')} style={{
                      padding: '9px', background: 'white', color: '#c0392b',
                      border: '1px solid #f5c6c2', borderRadius: '6px', fontWeight: '600', fontSize: '14px'
                    }}>Reject</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Passenger: Ride Results */}
        {role === 'passenger' && matches.length > 0 && (
          <div>
            <div style={{ fontSize: '17px', fontWeight: '600', marginBottom: '14px', color: '#1a1a1a' }}>
              {matches.length} ride{matches.length > 1 ? 's' : ''} found
            </div>
            {matches.map((m, i) => (
              <div key={i} style={{
                background: 'white', border: '1px solid #e8e8e8',
                borderRadius: '10px', padding: '18px', marginBottom: '10px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '15px' }}>{m.driver_name}</div>
                    <div style={{ color: '#888', fontSize: '13px', marginTop: '2px' }}>From: {m.start_location}</div>
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#1a1a1a' }}>
                    {m.compatibility_score}%
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                  {[
                    { label: 'Departure', value: new Date(m.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
                    { label: 'Seats', value: `${m.available_seats} left` },
                    { label: 'Distance', value: `${m.pickup_distance_meters}m` }
                  ].map((item, j) => (
                    <div key={j} style={{
                      background: '#f9f9f9', borderRadius: '6px',
                      padding: '10px 12px', border: '1px solid #f0f0f0'
                    }}>
                      <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '3px' }}>{item.label}</div>
                      <div style={{ fontWeight: '600', fontSize: '14px', color: '#1a1a1a' }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                <button onClick={() => handleRequestRide(m.ride_id)} style={{
                  width: '100%', padding: '10px',
                  background: '#1a1a1a', color: 'white',
                  border: 'none', borderRadius: '6px',
                  fontWeight: '600', fontSize: '14px'
                }}>Request ride</button>
              </div>
            ))}
          </div>
        )}

        {/* Passenger: My Request Status */}
        {role === 'passenger' && myStatus.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '600', color: '#1a1a1a' }}>My requests</div>
              <button onClick={fetchMyStatus} style={{
                padding: '6px 12px', background: 'white',
                border: '1px solid #ddd', borderRadius: '6px',
                fontSize: '13px', color: '#888'
              }}>Refresh</button>
            </div>
            {myStatus.map((r, i) => (
              <div key={i} style={{
                background: 'white', border: '1px solid #e8e8e8',
                borderRadius: '10px', padding: '16px', marginBottom: '10px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '15px' }}>{r.driver_name}</div>
                  <div style={{ color: '#888', fontSize: '13px', marginTop: '2px' }}>From: {r.start_location}</div>
                  <div style={{ color: '#aaa', fontSize: '13px' }}>
                    {new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {statusBadge(r.status)}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}