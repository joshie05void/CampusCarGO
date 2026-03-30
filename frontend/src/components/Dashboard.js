import { useState, useEffect } from 'react';
import axios from 'axios';
import MapPicker from './MapPicker';

// Yellow palette — single source of truth
const C = {
  bg:            '#fffbeb',
  card:          '#ffffff',
  subtle:        '#fefce8',
  border:        '#fde68a',
  borderLight:   '#fef3c7',
  accent:        '#d97706',
  accentDark:    '#b45309',
  text:          '#1c1917',
  muted:         '#78716c',
  faint:         '#a8a29e',
  successBg:     '#f0faf5',
  successBorder: '#b7e4c7',
  successText:   '#15803d',
  errorBg:       '#fdf3f2',
  errorBorder:   '#f5c6c2',
  errorText:     '#c0392b',
};

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

  const showMessage = (msg, type = 'success') => { setMessage(msg); setMessageType(type); };

  useEffect(() => {
    if (role === 'driver') { fetchRequests(); fetchMyRides(); }
    if (role === 'passenger') fetchMyStatus();
  }, []);

  const fetchRequests = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/requests', { headers: { Authorization: token } });
      setRequests(res.data.requests);
    } catch (err) { console.error(err); }
  };

  const fetchMyRides = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/myrides', { headers: { Authorization: token } });
      setMyRides(res.data.rides);
    } catch (err) { console.error(err); }
  };

  const handleDeleteRide = async (rideId) => {
    if (!window.confirm('Delete this ride?')) return;
    try {
      await axios.delete(`http://localhost:5000/api/rides/delete/${rideId}`, { headers: { Authorization: token } });
      showMessage('Ride deleted.', 'success');
      fetchMyRides();
    } catch (err) { showMessage(err.response?.data?.error || 'Error deleting ride', 'error'); }
  };

  const fetchMyStatus = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/mystatus', { headers: { Authorization: token } });
      setMyStatus(res.data.requests);
    } catch (err) { console.error(err); }
  };

  const handlePostRide = async () => {
    if (!pickupLocation) { showMessage('Please select a start location.', 'error'); return; }
    if (!departureTime) { showMessage('Please select a departure time.', 'error'); return; }
    setLoading(true);
    try {
      await axios.post('http://localhost:5000/api/rides/post', {
        start_location: pickupLocation.name, end_location: SCT.name,
        departure_time: departureTime, available_seats: seats,
        start_lat: pickupLocation.lat, start_lng: pickupLocation.lng,
        end_lat: SCT.lat, end_lng: SCT.lng,
      }, { headers: { Authorization: token } });
      showMessage('Ride posted successfully.', 'success');
    } catch (err) { showMessage(err.response?.data?.error || 'Error posting ride', 'error'); }
    setLoading(false);
  };

  const handleFindRides = async () => {
    if (!pickupLocation) { showMessage('Please select your pickup location.', 'error'); return; }
    if (!departureTime) { showMessage('Please select a departure time.', 'error'); return; }
    setLoading(true);
    try {
      const res = await axios.post('http://localhost:5000/api/match/find', {
        pickup_lat: pickupLocation.lat, pickup_lng: pickupLocation.lng,
        dropoff_lat: SCT.lat, dropoff_lng: SCT.lng, departure_time: departureTime,
      }, { headers: { Authorization: token } });
      setMatches(res.data.matches);
      if (res.data.matches.length === 0) showMessage('No rides found near your location.', 'error');
      else setMessage('');
    } catch (err) { showMessage(err.response?.data?.error || 'Error finding rides', 'error'); }
    setLoading(false);
  };

  const handleRequestRide = async (rideId) => {
    if (!pickupLocation) return;
    try {
      await axios.post('http://localhost:5000/api/rides/request', {
        ride_id: rideId, pickup_location: pickupLocation.name, dropoff_location: SCT.name,
      }, { headers: { Authorization: token } });
      showMessage('Ride requested. Waiting for driver confirmation.', 'success');
      fetchMyStatus();
    } catch (err) { showMessage(err.response?.data?.error || 'Error requesting ride', 'error'); }
  };

  const handleRespond = async (requestId, action) => {
    try {
      await axios.post('http://localhost:5000/api/rides/respond', { request_id: requestId, action }, { headers: { Authorization: token } });
      showMessage(`Request ${action}.`, 'success');
      fetchRequests();
    } catch (err) { showMessage(err.response?.data?.error || 'Error responding', 'error'); }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px',
    border: `1px solid ${C.border}`, borderRadius: '6px',
    fontSize: '15px', outline: 'none',
    background: C.card, color: C.text,
    transition: 'border-color 0.15s',
  };

  const labelStyle = { display: 'block', fontSize: '13px', color: C.muted, marginBottom: '6px' };

  const refreshBtn = (onClick) => (
    <button onClick={onClick} style={{
      padding: '6px 12px', background: C.card,
      border: `1px solid ${C.border}`, borderRadius: '6px',
      fontSize: '13px', color: C.muted, cursor: 'pointer',
      transition: 'border-color 0.15s',
    }}>Refresh</button>
  );

  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px' };

  const statusBadge = (status) => {
    const map = {
      accepted: { bg: C.successBg,  color: C.successText,  text: 'Accepted' },
      rejected: { bg: C.errorBg,    color: C.errorText,    text: 'Rejected' },
      pending:  { bg: '#fefce8',     color: C.accent,       text: 'Pending'  },
    };
    const s = map[status] || map.pending;
    return (
      <span style={{ background: s.bg, color: s.color, padding: '4px 10px', borderRadius: '4px', fontSize: '13px', fontWeight: '600' }}>
        {s.text}
      </span>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>

      {/* Navbar */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: '0 24px', height: '56px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontWeight: '700', fontSize: '17px', color: C.text, letterSpacing: '-0.3px' }}>
          CampusCarGO
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '13px', color: C.muted }}>
            {role === 'driver' ? 'Driver' : 'Passenger'}
          </span>
          <button onClick={onLogout} style={{
            padding: '7px 14px', background: C.card,
            border: `1px solid ${C.border}`, borderRadius: '6px',
            fontSize: '13px', fontWeight: '500', color: C.text, cursor: 'pointer',
            transition: 'border-color 0.15s',
          }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 20px' }}>

        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.text }}>
            {role === 'driver' ? 'Post a ride' : 'Find a ride'}
          </h1>
          <p style={{ color: C.muted, marginTop: '4px', fontSize: '14px' }}>
            {role === 'driver'
              ? 'Share your route to SCT and pick up passengers along the way.'
              : 'Find a driver heading to SCT near your location.'}
          </p>
        </div>

        {/* Form card */}
        <div style={{ ...card, padding: '24px', marginBottom: '24px' }}>
          <MapPicker
            label={role === 'driver' ? 'Start location' : 'Pickup location'}
            onLocationSelect={setPickupLocation}
          />

          {/* Destination */}
          <div style={{ marginBottom: '18px' }}>
            <label style={labelStyle}>Destination</label>
            <div style={{
              padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: '6px',
              fontSize: '15px', color: C.faint, background: C.subtle,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>SCT Pappanamcode</span>
              <span style={{ fontSize: '12px', color: C.faint }}>fixed</span>
            </div>
          </div>

          {/* Departure time */}
          <div style={{ marginBottom: '18px' }}>
            <label style={labelStyle}>Departure time</label>
            <input
              type="datetime-local" value={departureTime}
              onChange={e => setDepartureTime(e.target.value)}
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = C.border}
            />
          </div>

          {/* Seats (driver only) */}
          {role === 'driver' && (
            <div style={{ marginBottom: '18px' }}>
              <label style={labelStyle}>Available seats</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <button key={n} onClick={() => setSeats(n)} style={{
                    width: '40px', height: '40px',
                    border: `1px solid ${seats === n ? C.accent : C.border}`,
                    borderRadius: '6px',
                    background: seats === n ? C.accent : C.card,
                    color: seats === n ? 'white' : C.muted,
                    fontWeight: '600', fontSize: '15px', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}>{n}</button>
                ))}
              </div>
            </div>
          )}

          {/* Inline message */}
          {message && (
            <div style={{
              padding: '10px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '14px',
              background: messageType === 'success' ? C.successBg : C.errorBg,
              border: `1px solid ${messageType === 'success' ? C.successBorder : C.errorBorder}`,
              color: messageType === 'success' ? C.successText : C.errorText,
            }}>
              {message}
            </div>
          )}

          <button
            onClick={role === 'driver' ? handlePostRide : handleFindRides}
            disabled={loading}
            style={{
              width: '100%', padding: '11px',
              background: loading ? C.faint : C.accent,
              color: 'white', border: 'none', borderRadius: '6px',
              fontSize: '15px', fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}>
            {loading ? 'Please wait...' : role === 'driver' ? 'Post ride' : 'Find rides'}
          </button>
        </div>

        {/* ── Driver: My Posted Rides ─────────────────────────────────────── */}
        {role === 'driver' && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>
                My posted rides{' '}
                {myRides.length > 0 && <span style={{ color: C.muted, fontWeight: '400', fontSize: '14px' }}>({myRides.length})</span>}
              </h2>
              {refreshBtn(fetchMyRides)}
            </div>

            {myRides.length === 0 ? (
              <div style={{ ...card, padding: '24px', textAlign: 'center', color: C.faint, fontSize: '14px' }}>
                No rides posted yet.
              </div>
            ) : myRides.map((r, i) => (
              <div key={i} style={{
                ...card, padding: '18px', marginBottom: '10px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{r.start_location} → SCT</div>
                  <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>
                    {new Date(r.departure_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  <div style={{ color: C.faint, fontSize: '13px', marginTop: '2px' }}>
                    {r.available_seats} seat{r.available_seats !== 1 ? 's' : ''} · {r.status}
                  </div>
                </div>
                <button onClick={() => handleDeleteRide(r.id)} style={{
                  padding: '7px 14px', background: C.card, color: C.errorText,
                  border: `1px solid ${C.errorBorder}`, borderRadius: '6px',
                  fontSize: '13px', fontWeight: '500', cursor: 'pointer',
                }}>Delete</button>
              </div>
            ))}
          </div>
        )}

        {/* ── Driver: Incoming Requests ───────────────────────────────────── */}
        {role === 'driver' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>
                Incoming requests
                {requests.length > 0 && (
                  <span style={{
                    marginLeft: '8px', background: C.accent, color: 'white',
                    fontSize: '12px', padding: '2px 8px', borderRadius: '10px',
                  }}>{requests.length}</span>
                )}
              </div>
              {refreshBtn(fetchRequests)}
            </div>

            {requests.length === 0 ? (
              <div style={{ ...card, padding: '24px', textAlign: 'center', color: C.faint, fontSize: '14px' }}>
                No pending requests.
              </div>
            ) : requests.map((r, i) => (
              <div key={i} style={{ ...card, padding: '18px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{r.passenger_name}</div>
                    <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>Pickup: {r.pickup_location}</div>
                    <div style={{ color: C.faint, fontSize: '13px' }}>
                      {new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button onClick={() => handleRespond(r.id, 'accepted')} style={{
                    padding: '9px', background: C.accent, color: 'white',
                    border: 'none', borderRadius: '6px', fontWeight: '600', fontSize: '14px', cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}>Accept</button>
                  <button onClick={() => handleRespond(r.id, 'rejected')} style={{
                    padding: '9px', background: C.card, color: C.errorText,
                    border: `1px solid ${C.errorBorder}`, borderRadius: '6px',
                    fontWeight: '600', fontSize: '14px', cursor: 'pointer',
                  }}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Passenger: Ride Results ─────────────────────────────────────── */}
        {role === 'passenger' && matches.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>
                {matches.length} ride{matches.length > 1 ? 's' : ''} found
              </div>
              {matches[0]?.expanded_radius && (
                <div style={{
                  fontSize: '12px', color: C.accent, background: C.subtle,
                  border: `1px solid ${C.border}`, borderRadius: '4px', padding: '3px 8px',
                }}>
                  Expanded search area
                </div>
              )}
            </div>

            {matches.map((m, i) => (
              <div key={i} style={{ ...card, padding: '18px', marginBottom: '10px' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{m.driver_name}</div>
                    <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>From: {m.start_location}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '18px', fontWeight: '700', color: C.accent }}>
                      {m.compatibility_score}%
                    </div>
                    <div style={{
                      fontSize: '11px', fontWeight: '600', marginTop: '2px',
                      color: m.confidence === 'High' ? C.successText : m.confidence === 'Medium' ? C.accent : C.errorText,
                    }}>
                      {m.confidence} confidence
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                  {[
                    { label: 'Departure', value: new Date(m.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
                    { label: 'Seats',     value: `${m.available_seats} left` },
                    { label: 'Pickup dist.', value: `${m.pickup_distance_meters}m` },
                    { label: 'Detour',    value: m.detour_meters !== null ? `+${m.detour_meters}m` : 'N/A' },
                  ].map((item, j) => (
                    <div key={j} style={{
                      background: C.subtle, borderRadius: '6px',
                      padding: '10px 8px', border: `1px solid ${C.borderLight}`,
                    }}>
                      <div style={{ fontSize: '11px', color: C.faint, marginBottom: '3px' }}>{item.label}</div>
                      <div style={{ fontWeight: '600', fontSize: '13px', color: C.text }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                <button onClick={() => handleRequestRide(m.ride_id)} style={{
                  width: '100%', padding: '10px',
                  background: C.accent, color: 'white',
                  border: 'none', borderRadius: '6px',
                  fontWeight: '600', fontSize: '14px', cursor: 'pointer',
                  transition: 'background 0.15s',
                }}>Request ride</button>
              </div>
            ))}
          </div>
        )}

        {/* ── Passenger: empty state ──────────────────────────────────────── */}
        {role === 'passenger' && matches.length === 0 && myStatus.length === 0 && !message && (
          <div style={{ ...card, padding: '32px', textAlign: 'center', color: C.faint, fontSize: '14px' }}>
            Enter your pickup location and departure time, then tap{' '}
            <strong style={{ color: C.muted }}>Find rides</strong>.
          </div>
        )}

        {/* ── Passenger: My Requests ──────────────────────────────────────── */}
        {role === 'passenger' && myStatus.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>My requests</div>
              {refreshBtn(fetchMyStatus)}
            </div>
            {myStatus.map((r, i) => (
              <div key={i} style={{
                ...card, padding: '16px', marginBottom: '10px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{r.driver_name}</div>
                  <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>From: {r.start_location}</div>
                  <div style={{ color: C.faint, fontSize: '13px' }}>
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
