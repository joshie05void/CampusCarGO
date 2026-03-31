import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io as socketIO } from 'socket.io-client';
import MapPicker from './MapPicker';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';

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

// Feature 9 — Route Preview Map components (defined outside Dashboard)
function FitBounds({ latLngs }) {
  const map = useMap();
  useEffect(() => { if (latLngs.length > 0) map.fitBounds(latLngs, { padding: [20, 20] }); }, []);
  return null;
}

function RoutePreviewMap({ coordinates, pickupLat, pickupLng }) {
  const latLngs = coordinates.map(c => [c[1], c[0]]);
  const mid = latLngs[Math.floor(latLngs.length / 2)] || [8.5241, 76.9366];
  return (
    <MapContainer center={mid} zoom={13}
      style={{ height: '200px', borderRadius: '8px', marginBottom: '12px' }}
      scrollWheelZoom={false} dragging={false} zoomControl={false} attributionControl={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitBounds latLngs={latLngs} />
      <Polyline positions={latLngs} color="#d97706" weight={3} opacity={0.9} />
      {pickupLat && pickupLng && (
        <CircleMarker center={[pickupLat, pickupLng]} radius={8}
          color="#1c1917" fillColor="#d97706" fillOpacity={1} weight={2} />
      )}
    </MapContainer>
  );
}

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

  // Batch 1 state
  const [pendingRatings, setPendingRatings] = useState([]);
  const [dismissedRatings, setDismissedRatings] = useState(new Set());
  const [history, setHistory] = useState([]);
  const [confirmedPassengers, setConfirmedPassengers] = useState({});
  const [expandedRideId, setExpandedRideId] = useState(null);
  const [activeTab, setActiveTab] = useState('main');
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingHover, setRatingHover] = useState(0);

  // Batch 2 state
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [polylines, setPolylines] = useState({});
  const [expandedMatchId, setExpandedMatchId] = useState(null);
  const [filters, setFilters] = useState({ maxDist: 5000, timeWindow: null, minScore: 0, minRating: 0 });
  const notifRef = useRef(null);

  // Batch 3 state
  const [analytics, setAnalytics] = useState(null);

  // Toast state (floating feedback for request button)
  const [toast, setToast] = useState(null); // { msg, type }
  const toastTimerRef = useRef(null);
  const showToast = (msg, type = 'success') => {
    clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  };

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatRideId, setChatRideId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const chatMessagesEndRef = useRef(null);
  const socketRef = useRef(null);

  // Decode user id from JWT (payload only, no verification needed client-side)
  const myUserId = (() => {
    try { return JSON.parse(atob(token.split('.')[1])).id; } catch { return null; }
  })();

  const SCT = { lat: 8.5241, lng: 76.9366, name: 'SCT Pappanamcode' };

  const showMessage = (msg, type = 'success') => { setMessage(msg); setMessageType(type); };

  useEffect(() => {
    if (role === 'driver') { fetchRequests(); fetchMyRides(); fetchAnalytics(); }
    if (role === 'passenger') fetchMyStatus();
    fetchNotifications();
    fetchPendingRatings();
    fetchHistory();
    // Poll notifications every 30s, ride data every 15s (Issue 2 — auto-refresh)
    const notifInterval = setInterval(fetchNotifications, 30000);
    const rideInterval = setInterval(() => {
      if (role === 'driver') { fetchRequests(); fetchMyRides(); }
      if (role === 'passenger') fetchMyStatus();
      fetchPendingRatings();
    }, 15000);
    return () => { clearInterval(notifInterval); clearInterval(rideInterval); };
  }, []);

  // Feature 6 — close notif dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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

  const fetchMyStatus = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/mystatus', { headers: { Authorization: token } });
      setMyStatus(res.data.requests);
    } catch (err) { console.error(err); }
  };

  const fetchPendingRatings = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/pending-ratings', { headers: { Authorization: token } });
      setPendingRatings(res.data.pending_ratings || []);
    } catch (err) { console.error(err); }
  };

  const fetchHistory = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/history', { headers: { Authorization: token } });
      setHistory(res.data.history || []);
    } catch (err) { console.error(err); }
  };

  const fetchAnalytics = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/rides/analytics', { headers: { Authorization: token } });
      setAnalytics(res.data.analytics);
    } catch (err) { console.error(err); }
  };

  // Feature 6
  const fetchNotifications = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/notifications', { headers: { Authorization: token } });
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unread_count || 0);
    } catch (err) { console.error(err); }
  };

  const handleOpenNotifications = async () => {
    if (!showNotifDropdown && unreadCount > 0) {
      try {
        await axios.post('http://localhost:5000/api/notifications/read', {}, { headers: { Authorization: token } });
        setUnreadCount(0);
      } catch (err) { console.error(err); }
    }
    setShowNotifDropdown(prev => !prev);
  };

  const fetchConfirmedPassengers = async (rideId) => {
    try {
      const res = await axios.get(`http://localhost:5000/api/rides/confirmed-passengers/${rideId}`, { headers: { Authorization: token } });
      setConfirmedPassengers(prev => ({ ...prev, [rideId]: res.data.passengers }));
    } catch (err) { console.error(err); }
  };

  // Feature 9 — lazy polyline fetch
  const fetchPolyline = async (rideId) => {
    if (polylines[rideId]) return;
    try {
      const res = await axios.get(`http://localhost:5000/api/rides/${rideId}/polyline`, { headers: { Authorization: token } });
      setPolylines(prev => ({ ...prev, [rideId]: res.data.coordinates }));
    } catch (err) { console.error(err); }
  };

  const handleToggleMap = async (rideId) => {
    if (expandedMatchId === rideId) {
      setExpandedMatchId(null);
    } else {
      setExpandedMatchId(rideId);
      await fetchPolyline(rideId);
    }
  };

  const handleDeleteRide = async (rideId) => {
    if (!window.confirm('Delete this ride?')) return;
    try {
      await axios.delete(`http://localhost:5000/api/rides/delete/${rideId}`, { headers: { Authorization: token } });
      showMessage('Ride deleted.', 'success');
      fetchMyRides();
    } catch (err) { showMessage(err.response?.data?.error || 'Error deleting ride', 'error'); }
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
    // Feature 8 — reset filters on new search
    setFilters({ maxDist: 5000, timeWindow: null, minScore: 0, minRating: 0 });
    setExpandedMatchId(null);
    try {
      const res = await axios.post('http://localhost:5000/api/match/find', {
        pickup_lat: pickupLocation.lat, pickup_lng: pickupLocation.lng,
        dropoff_lat: SCT.lat, dropoff_lng: SCT.lng, departure_time: departureTime,
      }, { headers: { Authorization: token } });
      setMatches(res.data.matches);
      if (res.data.matches.length === 0) showMessage(res.data.message || 'No rides found near your location.', 'error');
      else setMessage('');
    } catch (err) { showMessage(err.response?.data?.error || 'Error finding rides', 'error'); }
    setLoading(false);
  };

  const handleRequestRide = async (match) => {
    if (!pickupLocation) { showToast('No pickup location selected.', 'error'); return; }
    try {
      await axios.post('http://localhost:5000/api/rides/request', {
        ride_id: match.ride_id,
        pickup_location: pickupLocation.name,
        dropoff_location: SCT.name,
        pickup_lat: pickupLocation.lat,
        pickup_lng: pickupLocation.lng,
        score: match.compatibility_score,
      }, { headers: { Authorization: token } });
      showToast('Ride requested! Waiting for driver confirmation.', 'success');
      fetchMyStatus();
    } catch (err) { showToast(err.response?.data?.error || 'Error requesting ride', 'error'); }
  };

  const handleRespond = async (requestId, action) => {
    try {
      await axios.post('http://localhost:5000/api/rides/respond', { request_id: requestId, action }, { headers: { Authorization: token } });
      showMessage(`Request ${action}.`, 'success');
      fetchRequests();
    } catch (err) { showMessage(err.response?.data?.error || 'Error responding', 'error'); }
  };

  const handleCancelRequest = async (requestId) => {
    try {
      await axios.post(`http://localhost:5000/api/rides/cancel-request/${requestId}`, {}, { headers: { Authorization: token } });
      showMessage('Request cancelled.', 'success');
      fetchMyStatus();
    } catch (err) { showMessage(err.response?.data?.error || 'Error cancelling request', 'error'); }
  };

  const handleStartRide = async (rideId) => {
    try {
      await axios.post(`http://localhost:5000/api/rides/start/${rideId}`, {}, { headers: { Authorization: token } });
      showMessage('Ride started.', 'success');
      fetchMyRides();
    } catch (err) { showMessage(err.response?.data?.error || 'Error starting ride', 'error'); }
  };

  const handleCompleteRide = async (rideId) => {
    try {
      await axios.post(`http://localhost:5000/api/rides/complete/${rideId}`, {}, { headers: { Authorization: token } });
      showMessage('Ride completed.', 'success');
      // Refresh rides, then immediately fetch pending ratings so the rating prompt appears for the driver
      fetchMyRides();
      await fetchPendingRatings();
      setRatingStars(0);
      setRatingHover(0);
    } catch (err) { showMessage(err.response?.data?.error || 'Error completing ride', 'error'); }
  };

  const handleRate = async (rideId, rateeId, stars) => {
    try {
      await axios.post('http://localhost:5000/api/rides/rate', { ride_id: rideId, ratee_id: rateeId, stars }, { headers: { Authorization: token } });
      setPendingRatings(prev => prev.filter(r => !(r.ride_id === rideId && r.ratee_id === rateeId)));
      setRatingStars(0);
      showMessage('Rating submitted.', 'success');
    } catch (err) { showMessage(err.response?.data?.error || 'Error submitting rating', 'error'); }
  };

  const handleTogglePassengers = async (rideId) => {
    if (expandedRideId === rideId) {
      setExpandedRideId(null);
    } else {
      setExpandedRideId(rideId);
      if (!confirmedPassengers[rideId]) {
        await fetchConfirmedPassengers(rideId);
      }
    }
  };

  // ── Socket.IO setup ───────────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketIO('http://localhost:5000', { auth: { token } });
    socketRef.current = socket;
    socket.on('new_message', (msg) => {
      setChatMessages(prev => [...prev, msg]);
    });
    return () => socket.disconnect();
  }, []);

  // Join / leave ride room when chatRideId changes
  useEffect(() => {
    if (!socketRef.current) return;
    if (chatRideId) {
      socketRef.current.emit('join_ride', chatRideId);
      fetchChatMessages(chatRideId);
    }
    return () => {
      if (chatRideId) socketRef.current?.emit('leave_ride', chatRideId);
    };
  }, [chatRideId]);

  const fetchChatMessages = async (rideId) => {
    if (!rideId) return;
    try {
      const res = await axios.get(`http://localhost:5000/api/chat/${rideId}`, { headers: { Authorization: token } });
      setChatMessages(res.data.messages || []);
    } catch (err) { console.error(err); }
  };

  const handleOpenChat = (rideId) => {
    setChatRideId(rideId);
    setChatMessages([]);
    setChatOpen(true);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !chatRideId || chatSending) return;
    setChatSending(true);
    const text = chatInput.trim();
    setChatInput('');
    try {
      await axios.post(`http://localhost:5000/api/chat/${chatRideId}`,
        { message: text },
        { headers: { Authorization: token } }
      );
      // Server emits 'new_message' via socket — no need to re-fetch
    } catch (err) {
      console.error(err);
      setChatInput(text); // restore on error
    }
    setChatSending(false);
  };

  // Auto-scroll to latest message
  useEffect(() => {
    if (chatMessagesEndRef.current) {
      chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Open chat — once open, only the Close Chat button (×) can close it (Issue 1)
  const handleToggleChat = () => {
    if (chatOpen) return; // already open — do nothing, use × to close
    if (role === 'passenger') {
      const accepted = myStatus.find(
        r => r.status === 'accepted' && !['completed', 'expired'].includes(r.ride_status)
      );
      if (accepted) handleOpenChat(accepted.ride_id);
      else setChatOpen(true);
    } else {
      setChatOpen(true);
    }
  };

  // Chat rides available for driver (active/in_progress rides)
  const chatableRides = role === 'driver'
    ? myRides.filter(r => ['active', 'in_progress'].includes(r.status))
    : [];

  const relativeTime = (dateStr) => {
    const diff = Math.round((new Date(dateStr) - new Date()) / 60000);
    if (diff > 0) return `in ${diff} min`;
    if (diff > -60) return `${Math.abs(diff)} min ago`;
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const relativeTimeShort = (dateStr) => {
    const diffMs = new Date() - new Date(dateStr);
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const renderStars = (rating) => {
    if (!rating) return '—';
    const full = Math.round(Number(rating));
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  };

  // Feature 8 — client-side filter logic
  const filteredMatches = matches.filter(m => {
    if (m.pickup_distance_meters > filters.maxDist) return false;
    if (filters.timeWindow !== null) {
      const diffMin = Math.abs(m.time_diff_minutes ?? 0);
      if (diffMin > filters.timeWindow) return false;
    }
    if (m.compatibility_score < filters.minScore) return false;
    if (filters.minRating > 0 && m.driver_avg_rating !== null) {
      if (Number(m.driver_avg_rating) < filters.minRating) return false;
    }
    return true;
  });

  // Feature 8 — count active (non-default) filters
  const activeFilterCount = [
    filters.maxDist < 5000,
    filters.timeWindow !== null,
    filters.minScore > 0,
    filters.minRating > 0,
  ].filter(Boolean).length;

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
    }}>Refresh</button>
  );

  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px' };

  const statusBadge = (status) => {
    const map = {
      accepted:    { bg: C.successBg,  color: C.successText, text: 'Accepted'    },
      rejected:    { bg: C.errorBg,    color: C.errorText,   text: 'Rejected'    },
      pending:     { bg: '#fefce8',    color: C.accent,      text: 'Pending'     },
      cancelled:   { bg: '#f5f5f4',    color: C.muted,       text: 'Cancelled'   },
      active:      { bg: '#fefce8',    color: C.accent,      text: 'Active'      },
      in_progress: { bg: '#eff6ff',    color: '#1d4ed8',     text: 'In Progress' },
      completed:   { bg: C.successBg,  color: C.successText, text: 'Completed'   },
      expired:     { bg: '#f5f5f4',    color: C.muted,       text: 'Expired'     },
    };
    const s = map[status] || map.pending;
    return (
      <span style={{ background: s.bg, color: s.color, padding: '4px 10px', borderRadius: '4px', fontSize: '13px', fontWeight: '600' }}>
        {s.text}
      </span>
    );
  };

  const currentRatingPrompt = pendingRatings.find(
    r => !dismissedRatings.has(`${r.ride_id}-${r.ratee_id}`)
  );

  const tabs = [
    { key: 'main', label: 'Main' },
    { key: 'history', label: 'History' },
    ...(role === 'driver' ? [{ key: 'analytics', label: 'Analytics' }] : []),
  ];

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

          {/* Chat button — opens chat; close via the Close Chat button inside the panel */}
          <button onClick={handleToggleChat} style={{
            position: 'relative', padding: '7px 12px', background: chatOpen ? C.accent : C.card,
            border: `1px solid ${chatOpen ? C.accent : C.border}`, borderRadius: '6px',
            fontSize: '13px', color: chatOpen ? 'white' : C.muted,
            cursor: chatOpen ? 'default' : 'pointer',
          }}>
            💬
          </button>

          {/* Feature 6 — Notifications */}
          <div ref={notifRef} style={{ position: 'relative' }}>
            <button onClick={handleOpenNotifications} style={{
              position: 'relative', padding: '7px 12px', background: C.card,
              border: `1px solid ${C.border}`, borderRadius: '6px',
              fontSize: '13px', color: C.muted, cursor: 'pointer',
            }}>
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: '-6px', right: '-6px',
                  background: C.accent, color: 'white',
                  fontSize: '11px', fontWeight: '700',
                  minWidth: '18px', height: '18px', borderRadius: '9px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 4px',
                }}>{unreadCount}</span>
              )}
            </button>

            {showNotifDropdown && (
              <div style={{
                position: 'absolute', right: 0, top: '44px', width: '320px',
                background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 1000,
                maxHeight: '360px', overflowY: 'auto',
              }}>
                <div style={{
                  padding: '12px 16px', borderBottom: `1px solid ${C.borderLight}`,
                  fontSize: '13px', fontWeight: '600', color: C.text,
                }}>Notifications</div>
                {notifications.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: C.faint, fontSize: '13px' }}>
                    No notifications yet.
                  </div>
                ) : notifications.map((n, i) => (
                  <div key={i} style={{
                    padding: '12px 16px',
                    borderBottom: i < notifications.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                  }}>
                    <div style={{ fontSize: '13px', color: C.text }}>{n.message}</div>
                    <div style={{ fontSize: '11px', color: C.faint, marginTop: '4px' }}>{relativeTimeShort(n.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={onLogout} style={{
            padding: '7px 14px', background: C.card,
            border: `1px solid ${C.border}`, borderRadius: '6px',
            fontSize: '13px', fontWeight: '500', color: C.text, cursor: 'pointer',
          }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 20px' }}>

        {/* Feature 4 — Rating Prompt */}
        {currentRatingPrompt && (
          <div style={{ ...card, padding: '20px', marginBottom: '20px', borderColor: C.accent }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
              <div>
                <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>
                  Rate {currentRatingPrompt.ratee_name}
                </div>
                <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>
                  Ride from {currentRatingPrompt.start_location}
                </div>
              </div>
              <button
                onClick={() => { setDismissedRatings(prev => new Set([...prev, `${currentRatingPrompt.ride_id}-${currentRatingPrompt.ratee_id}`])); setRatingStars(0); setRatingHover(0); }}
                style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '2px 6px' }}
              >×</button>
            </div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  onClick={() => setRatingStars(star)}
                  onMouseEnter={() => setRatingHover(star)}
                  onMouseLeave={() => setRatingHover(0)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '30px', padding: '0 2px',
                    color: star <= (ratingHover || ratingStars) ? C.accent : C.borderLight,
                    transition: 'color 0.1s',
                  }}
                >★</button>
              ))}
            </div>
            <button
              onClick={() => ratingStars > 0 && handleRate(currentRatingPrompt.ride_id, currentRatingPrompt.ratee_id, ratingStars)}
              disabled={ratingStars === 0}
              style={{
                padding: '9px 20px',
                background: ratingStars > 0 ? C.accent : C.faint,
                color: 'white', border: 'none', borderRadius: '6px',
                fontWeight: '600', fontSize: '14px',
                cursor: ratingStars > 0 ? 'pointer' : 'not-allowed',
              }}
            >Submit rating</button>
          </div>
        )}

        {/* Tab bar */}
        <div style={{ borderBottom: `1px solid ${C.borderLight}`, marginBottom: '24px', display: 'flex' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 18px', background: 'none', border: 'none',
                borderBottom: activeTab === tab.key ? `2px solid ${C.accent}` : '2px solid transparent',
                color: activeTab === tab.key ? C.accent : C.muted,
                fontWeight: activeTab === tab.key ? '600' : '400',
                fontSize: '14px', cursor: 'pointer',
                marginBottom: '-1px', transition: 'color 0.15s',
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* ── MAIN TAB ──────────────────────────────────────────────────────── */}
        {activeTab === 'main' && (
          <>
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

            {/* ── Driver: My Posted Rides ──────────────────────────────────── */}
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
                  <div key={i} style={{ ...card, padding: '18px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{r.start_location} → SCT</div>
                        <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>
                          {new Date(r.departure_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </div>
                        <div style={{ color: C.faint, fontSize: '13px', marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span>{r.available_seats} seat{r.available_seats !== 1 ? 's' : ''}</span>
                          {statusBadge(r.status)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        <button onClick={() => handleTogglePassengers(r.id)} style={{
                          padding: '7px 12px', background: C.subtle,
                          border: `1px solid ${C.border}`, borderRadius: '6px',
                          fontSize: '13px', color: C.muted, cursor: 'pointer',
                        }}>
                          {expandedRideId === r.id ? 'Hide' : 'Passengers'}
                        </button>
                        <button onClick={() => handleDeleteRide(r.id)} style={{
                          padding: '7px 14px', background: C.card, color: C.errorText,
                          border: `1px solid ${C.errorBorder}`, borderRadius: '6px',
                          fontSize: '13px', fontWeight: '500', cursor: 'pointer',
                        }}>Delete</button>
                      </div>
                    </div>

                    {expandedRideId === r.id && (
                      <div style={{ borderTop: `1px solid ${C.borderLight}`, paddingTop: '14px' }}>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                          {r.status === 'active' && (
                            <button onClick={() => handleStartRide(r.id)} style={{
                              padding: '8px 16px', background: C.accent, color: 'white',
                              border: 'none', borderRadius: '6px',
                              fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                            }}>Mark as Started</button>
                          )}
                          {r.status === 'in_progress' && (
                            <button onClick={() => handleCompleteRide(r.id)} style={{
                              padding: '8px 16px', background: C.successText, color: 'white',
                              border: 'none', borderRadius: '6px',
                              fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                            }}>Mark as Completed</button>
                          )}
                        </div>

                        {!confirmedPassengers[r.id] ? (
                          <div style={{ color: C.faint, fontSize: '13px' }}>Loading passengers...</div>
                        ) : confirmedPassengers[r.id].length === 0 ? (
                          <div style={{ color: C.faint, fontSize: '13px' }}>No confirmed passengers yet.</div>
                        ) : (
                          <>
                            <div style={{ fontSize: '13px', fontWeight: '600', color: C.muted, marginBottom: '8px' }}>
                              Confirmed passengers ({confirmedPassengers[r.id].length})
                            </div>
                            {confirmedPassengers[r.id].map((p, pi) => (
                              <div key={pi} style={{
                                background: C.subtle, borderRadius: '6px', padding: '10px 12px',
                                marginBottom: '6px', border: `1px solid ${C.borderLight}`,
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              }}>
                                <div>
                                  <div style={{ fontWeight: '600', fontSize: '14px', color: C.text }}>
                                    {pi + 1}. {p.passenger_name}
                                  </div>
                                  <div style={{ color: C.muted, fontSize: '12px', marginTop: '2px' }}>{p.pickup_location}</div>
                                </div>
                                <div style={{ color: C.faint, fontSize: '12px' }}>
                                  {p.pickup_distance_m != null ? `${Math.round(p.pickup_distance_m)}m` : ''}
                                </div>
                              </div>
                            ))}
                            <div style={{ fontSize: '12px', color: C.muted, marginTop: '8px' }}>
                              Est. total detour: ~{Math.round(
                                confirmedPassengers[r.id].reduce((sum, p) => sum + (p.pickup_distance_m || 0) * 2, 0)
                              )}m
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Driver: Incoming Requests ────────────────────────────────── */}
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

            {/* ── Passenger: Feature 1 — Confirmed Ride Card ──────────────── */}
            {role === 'passenger' && (() => {
              const acceptedRide = myStatus.find(
                r => r.status === 'accepted' && !['completed', 'expired'].includes(r.ride_status)
              );
              return acceptedRide ? (
                <div style={{
                  ...card, padding: '20px', marginBottom: '24px',
                  borderColor: C.successBorder, background: C.successBg,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: C.successText, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                        Ride Confirmed
                      </div>
                      <div style={{ fontWeight: '700', fontSize: '17px', color: C.text }}>{acceptedRide.driver_name}</div>
                      <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>From {acceptedRide.start_location}</div>
                    </div>
                    {acceptedRide.driver_avg_rating && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: C.accent, fontSize: '16px' }}>{renderStars(acceptedRide.driver_avg_rating)}</div>
                        <div style={{ color: C.faint, fontSize: '11px' }}>{Number(acceptedRide.driver_avg_rating).toFixed(1)} avg</div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                    <div style={{ background: C.card, borderRadius: '6px', padding: '10px', border: `1px solid ${C.borderLight}` }}>
                      <div style={{ fontSize: '11px', color: C.faint, marginBottom: '2px' }}>Pickup</div>
                      <div style={{ fontSize: '13px', color: C.text, fontWeight: '500' }}>{acceptedRide.pickup_location}</div>
                    </div>
                    <div style={{ background: C.card, borderRadius: '6px', padding: '10px', border: `1px solid ${C.borderLight}` }}>
                      <div style={{ fontSize: '11px', color: C.faint, marginBottom: '2px' }}>Departure</div>
                      <div style={{ fontSize: '13px', color: C.text, fontWeight: '500' }}>
                        {new Date(acceptedRide.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div style={{ fontSize: '11px', color: C.muted }}>{relativeTime(acceptedRide.departure_time)}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCancelRequest(acceptedRide.id)}
                    style={{
                      width: '100%', padding: '9px', background: C.card, color: C.errorText,
                      border: `1px solid ${C.errorBorder}`, borderRadius: '6px',
                      fontWeight: '600', fontSize: '14px', cursor: 'pointer',
                    }}
                  >Cancel ride</button>
                </div>
              ) : null;
            })()}

            {/* ── Passenger: Feature 8 — Search Filters ───────────────────── */}
            {role === 'passenger' && matches.length > 0 && (
              <div style={{ ...card, padding: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: C.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    Filters
                    {activeFilterCount > 0 && (
                      <span style={{
                        background: C.accent, color: 'white',
                        fontSize: '11px', padding: '2px 7px', borderRadius: '10px', fontWeight: '700',
                      }}>{activeFilterCount}</span>
                    )}
                  </div>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={() => setFilters({ maxDist: 5000, timeWindow: null, minScore: 0, minRating: 0 })}
                      style={{ background: 'none', border: 'none', color: C.accent, fontSize: '13px', cursor: 'pointer', fontWeight: '500' }}
                    >Reset</button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  {/* Max pickup distance */}
                  <div>
                    <label style={{ ...labelStyle, marginBottom: '4px' }}>
                      Max distance: {filters.maxDist >= 5000 ? 'Any' : `${filters.maxDist}m`}
                    </label>
                    <input type="range" min="500" max="5000" step="500"
                      value={filters.maxDist}
                      onChange={e => setFilters(f => ({ ...f, maxDist: Number(e.target.value) }))}
                      style={{ width: '100%', accentColor: C.accent }}
                    />
                  </div>

                  {/* Min score */}
                  <div>
                    <label style={{ ...labelStyle, marginBottom: '4px' }}>
                      Min score: {filters.minScore > 0 ? `${filters.minScore}%` : 'Any'}
                    </label>
                    <input type="range" min="0" max="100" step="10"
                      value={filters.minScore}
                      onChange={e => setFilters(f => ({ ...f, minScore: Number(e.target.value) }))}
                      style={{ width: '100%', accentColor: C.accent }}
                    />
                  </div>

                  {/* Time window */}
                  <div>
                    <label style={labelStyle}>Departure window</label>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {[null, 30, 60, 90].map(w => (
                        <button key={String(w)}
                          onClick={() => setFilters(f => ({ ...f, timeWindow: w }))}
                          style={{
                            padding: '4px 10px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer',
                            border: `1px solid ${filters.timeWindow === w ? C.accent : C.border}`,
                            background: filters.timeWindow === w ? C.accent : C.card,
                            color: filters.timeWindow === w ? 'white' : C.muted,
                          }}
                        >{w === null ? 'Any' : `±${w}m`}</button>
                      ))}
                    </div>
                  </div>

                  {/* Min driver rating */}
                  <div>
                    <label style={labelStyle}>Min driver rating</label>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {[0, 1, 2, 3, 4, 5].map(r => (
                        <button key={r}
                          onClick={() => setFilters(f => ({ ...f, minRating: r }))}
                          style={{
                            padding: '4px 10px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer',
                            border: `1px solid ${filters.minRating === r ? C.accent : C.border}`,
                            background: filters.minRating === r ? C.accent : C.card,
                            color: filters.minRating === r ? 'white' : C.muted,
                          }}
                        >{r === 0 ? 'Any' : `${r}★`}</button>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '10px', fontSize: '12px', color: C.faint }}>
                  Showing {filteredMatches.length} of {matches.length} ride{matches.length !== 1 ? 's' : ''}
                </div>
              </div>
            )}

            {/* ── Passenger: Ride Results ──────────────────────────────────── */}
            {role === 'passenger' && matches.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <div style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>
                    {filteredMatches.length} ride{filteredMatches.length !== 1 ? 's' : ''} found
                  </div>
                </div>

                {filteredMatches.map((m, i) => {
                  const scoreColor = m.compatibility_score >= 60 ? C.successText : m.compatibility_score >= 35 ? C.accent : C.errorText;
                  const confColor = m.confidence === 'high' ? C.successText : m.confidence === 'medium' ? C.accent : C.errorText;
                  const confBg = m.confidence === 'high' ? C.successBg : m.confidence === 'medium' ? C.subtle : C.errorBg;
                  // Feature 10 — fully booked
                  const fullyBooked = m.available_seats === 0;

                  return (
                    <div key={i} style={{ ...card, padding: '18px', marginBottom: '10px' }}>
                      {/* Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{m.driver_name}</div>
                          <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>From: {m.start_location}</div>
                          {m.driver_avg_rating && (
                            <div style={{ color: C.accent, fontSize: '12px', marginTop: '2px' }}>
                              {'★'.repeat(Math.round(m.driver_avg_rating))}{'☆'.repeat(5 - Math.round(m.driver_avg_rating))}{' '}
                              <span style={{ color: C.faint }}>{Number(m.driver_avg_rating).toFixed(1)}</span>
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '20px', fontWeight: '700', color: scoreColor }}>
                            {m.compatibility_score}%
                          </div>
                          <span style={{
                            background: confBg, color: confColor,
                            padding: '2px 8px', borderRadius: '4px',
                            fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
                          }}>{m.confidence}</span>
                          {/* Feature 10 — fully booked badge */}
                          {fullyBooked && (
                            <div style={{
                              marginTop: '4px', background: C.errorBg, color: C.errorText,
                              padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                            }}>Fully Booked</div>
                          )}
                        </div>
                      </div>

                      {/* Info chips */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                        {[
                          { icon: '🕐', text: m.time_label || new Date(m.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
                          { icon: '💺', text: `${m.available_seats} seat${m.available_seats !== 1 ? 's' : ''}` },
                          { icon: '📍', text: m.distance_label || `${m.pickup_distance_meters}m away` },
                          { icon: '🛣️', text: m.detour_label || 'On route' },
                          { icon: '📌', text: m.position_label || '' },
                        ].filter(c => c.text).map((chip, j) => (
                          <span key={j} style={{
                            background: C.subtle, padding: '4px 10px', borderRadius: '20px',
                            fontSize: '12px', color: C.muted, whiteSpace: 'nowrap',
                            border: `1px solid ${C.borderLight}`,
                          }}>{chip.icon} {chip.text}</span>
                        ))}
                      </div>

                      {/* Score breakdown bars */}
                      {m.score_breakdown && (
                        <div style={{
                          background: C.subtle, borderRadius: '8px', padding: '12px',
                          marginBottom: '14px', border: `1px solid ${C.borderLight}`,
                        }}>
                          <div style={{ fontSize: '12px', color: C.muted, marginBottom: '8px', fontWeight: '600' }}>Score Breakdown</div>
                          {[
                            { label: 'Detour Cost', value: m.score_breakdown.detour, weight: '40%' },
                            { label: 'Route Position', value: m.score_breakdown.position, weight: '25%' },
                            { label: 'Time Match', value: m.score_breakdown.time, weight: '20%' },
                            { label: 'Proximity', value: m.score_breakdown.proximity, weight: '15%' },
                          ].map((bar, k) => (
                            <div key={k} style={{ marginBottom: k < 3 ? '6px' : 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: C.faint, marginBottom: '3px' }}>
                                <span>{bar.label} <span style={{ color: C.borderLight }}>({bar.weight})</span></span>
                                <span style={{ fontWeight: '600', color: C.muted }}>{bar.value}%</span>
                              </div>
                              <div style={{ height: '4px', background: C.borderLight, borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{
                                  width: `${bar.value}%`, height: '100%', borderRadius: '2px',
                                  background: bar.value >= 60 ? C.successText : bar.value >= 35 ? C.accent : C.errorText,
                                  transition: 'width 0.5s ease',
                                }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Feature 9 — Route Preview Map toggle */}
                      <button
                        onClick={() => handleToggleMap(m.ride_id)}
                        style={{
                          width: '100%', padding: '8px', marginBottom: '10px',
                          background: C.subtle, color: C.muted,
                          border: `1px solid ${C.borderLight}`, borderRadius: '6px',
                          fontSize: '13px', cursor: 'pointer',
                        }}
                      >{expandedMatchId === m.ride_id ? 'Hide map' : 'Show map'}</button>

                      {expandedMatchId === m.ride_id && polylines[m.ride_id] && (
                        <RoutePreviewMap
                          coordinates={polylines[m.ride_id]}
                          pickupLat={pickupLocation?.lat}
                          pickupLng={pickupLocation?.lng}
                        />
                      )}

                      {expandedMatchId === m.ride_id && !polylines[m.ride_id] && (
                        <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: '13px', marginBottom: '12px' }}>
                          Loading map...
                        </div>
                      )}

                      {/* Feature 10 — disabled when fully booked */}
                      <button
                        onClick={() => !fullyBooked && handleRequestRide(m)}
                        disabled={fullyBooked}
                        style={{
                          width: '100%', padding: '10px',
                          background: fullyBooked ? C.faint : C.accent,
                          color: 'white', border: 'none', borderRadius: '6px',
                          fontWeight: '600', fontSize: '14px',
                          cursor: fullyBooked ? 'not-allowed' : 'pointer',
                          transition: 'background 0.15s',
                        }}
                      >{fullyBooked ? 'Fully Booked' : 'Request ride'}</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Passenger: empty state ───────────────────────────────────── */}
            {role === 'passenger' && matches.length === 0 && myStatus.length === 0 && !message && (
              <div style={{ ...card, padding: '32px', textAlign: 'center', color: C.faint, fontSize: '14px' }}>
                Enter your pickup location and departure time, then tap{' '}
                <strong style={{ color: C.muted }}>Find rides</strong>.
              </div>
            )}

            {/* ── Passenger: My Requests ───────────────────────────────────── */}
            {role === 'passenger' && myStatus.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <div style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>My requests</div>
                  {refreshBtn(fetchMyStatus)}
                </div>
                {myStatus.map((r, i) => {
                  if (r.status === 'accepted' && !['completed', 'expired'].includes(r.ride_status)) return null;
                  return (
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
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── HISTORY TAB (Feature 5) ───────────────────────────────────────── */}
        {activeTab === 'history' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>Ride history</h2>
              {refreshBtn(fetchHistory)}
            </div>

            {history.length === 0 ? (
              <div style={{ ...card, padding: '32px', textAlign: 'center', color: C.faint, fontSize: '14px' }}>
                No completed rides yet.
              </div>
            ) : history.map((h, i) => (
              <div key={i} style={{ ...card, padding: '18px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>
                      {h.start_location} → SCT
                    </div>
                    <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>
                      {new Date(h.departure_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  </div>
                  {statusBadge(h.status || 'completed')}
                </div>

                {role === 'driver' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '13px', color: C.muted }}>
                    {h.passenger_count != null && (
                      <span>👥 {h.passenger_count} passenger{Number(h.passenger_count) !== 1 ? 's' : ''}</span>
                    )}
                    {h.avg_rating_received != null && (
                      <span style={{ color: C.accent }}>★ {Number(h.avg_rating_received).toFixed(1)} avg rating received</span>
                    )}
                    {h.ratings_given && h.ratings_given.length > 0 && (
                      <div style={{ width: '100%', marginTop: '4px' }}>
                        <div style={{ fontSize: '12px', color: C.faint, marginBottom: '4px' }}>Ratings given:</div>
                        {h.ratings_given.map((rg, j) => (
                          <span key={j} style={{ marginRight: '10px', fontSize: '12px', color: C.muted }}>
                            {rg.ratee_name}: {'★'.repeat(rg.stars)}{'☆'.repeat(5 - rg.stars)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {role === 'passenger' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '13px', color: C.muted }}>
                    {h.driver_name && <span>Driver: {h.driver_name}</span>}
                    {h.rating_given != null && (
                      <span style={{ color: C.accent }}>
                        You rated: {'★'.repeat(h.rating_given)}{'☆'.repeat(5 - h.rating_given)}
                      </span>
                    )}
                    {h.rating_received != null && (
                      <span style={{ color: C.successText }}>
                        Received: {'★'.repeat(h.rating_received)}{'☆'.repeat(5 - h.rating_received)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── ANALYTICS TAB (Feature 11) — driver only ─────────────────────── */}
        {activeTab === 'analytics' && role === 'driver' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: '600', color: C.text }}>Your stats</h2>
              <button onClick={fetchAnalytics} style={{
                padding: '6px 12px', background: C.card,
                border: `1px solid ${C.border}`, borderRadius: '6px',
                fontSize: '13px', color: C.muted, cursor: 'pointer',
              }}>Refresh</button>
            </div>

            {!analytics ? (
              <div style={{ ...card, padding: '32px', textAlign: 'center', color: C.faint, fontSize: '14px' }}>
                No analytics yet. Post and complete rides to see your stats.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ background: C.subtle, border: `1px solid ${C.borderLight}`, borderRadius: '10px', padding: '20px' }}>
                  <div style={{ fontSize: '13px', color: C.muted, marginBottom: '6px' }}>Total rides given</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: C.text }}>{analytics.total_rides ?? 0}</div>
                </div>
                <div style={{ background: C.subtle, border: `1px solid ${C.borderLight}`, borderRadius: '10px', padding: '20px' }}>
                  <div style={{ fontSize: '13px', color: C.muted, marginBottom: '6px' }}>Total passengers</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: C.text }}>{analytics.total_passengers ?? 0}</div>
                </div>
                <div style={{ background: C.subtle, border: `1px solid ${C.borderLight}`, borderRadius: '10px', padding: '20px' }}>
                  <div style={{ fontSize: '13px', color: C.muted, marginBottom: '6px' }}>Avg compatibility score</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: C.accent }}>
                    {analytics.avg_score != null ? `${Math.round(analytics.avg_score)}%` : '—'}
                  </div>
                </div>
                <div style={{ background: C.subtle, border: `1px solid ${C.borderLight}`, borderRadius: '10px', padding: '20px' }}>
                  <div style={{ fontSize: '13px', color: C.muted, marginBottom: '6px' }}>Avg rating received</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: C.accent }}>
                    {analytics.avg_rating != null ? (
                      <>
                        <span style={{ fontSize: '20px' }}>{'★'.repeat(Math.round(analytics.avg_rating))}{'☆'.repeat(5 - Math.round(analytics.avg_rating))}</span>
                        <span style={{ fontSize: '16px', color: C.muted, marginLeft: '6px' }}>{Number(analytics.avg_rating).toFixed(1)}</span>
                      </>
                    ) : '—'}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Toast notification ──────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'success' ? C.successText : C.errorText,
          color: 'white', padding: '12px 22px', borderRadius: '8px',
          fontSize: '14px', fontWeight: '500',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          zIndex: 2000, pointerEvents: 'none',
          maxWidth: '360px', textAlign: 'center',
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── Chat Side Panel ─────────────────────────────────────────────── */}
      {chatOpen && (
        <div style={{
          position: 'fixed', top: '56px', right: 0,
          width: '320px', height: 'calc(100vh - 56px)',
          background: C.card, borderLeft: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column',
          boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
          zIndex: 900,
        }}>
          {/* Panel header */}
          <div style={{
            padding: '14px 16px', borderBottom: `1px solid ${C.borderLight}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div style={{ fontWeight: '600', fontSize: '14px', color: C.text }}>Chat</div>
            <button onClick={() => setChatOpen(false)} style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: '6px', color: C.muted,
              cursor: 'pointer', fontSize: '12px', fontWeight: '500',
              padding: '4px 10px',
            }}>Close Chat</button>
          </div>

          {/* Driver: ride selector */}
          {role === 'driver' && (
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.borderLight}`, flexShrink: 0 }}>
              {chatableRides.length === 0 ? (
                <div style={{ fontSize: '13px', color: C.faint, textAlign: 'center', padding: '6px 0' }}>
                  No active rides to chat in.
                </div>
              ) : (
                <select
                  value={chatRideId || ''}
                  onChange={e => {
                    const id = Number(e.target.value);
                    setChatRideId(id || null);
                    setChatMessages([]);
                  }}
                  style={{
                    width: '100%', padding: '8px 10px',
                    border: `1px solid ${C.border}`, borderRadius: '6px',
                    fontSize: '13px', color: C.text, background: C.card,
                    outline: 'none', cursor: 'pointer',
                  }}
                >
                  <option value="">Select a ride…</option>
                  {chatableRides.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.start_location} → SCT · {new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Passenger: no active accepted ride */}
          {role === 'passenger' && !chatRideId && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
              <div style={{ textAlign: 'center', color: C.faint, fontSize: '13px' }}>
                You need an accepted ride to use chat.
              </div>
            </div>
          )}

          {/* Messages list */}
          {chatRideId && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                {chatMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: C.faint, fontSize: '13px', marginTop: '20px' }}>
                    No messages yet. Say hi!
                  </div>
                ) : chatMessages.map((msg, i) => {
                  const isMine = msg.sender_id === myUserId;
                  return (
                    <div key={i} style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: isMine ? 'flex-end' : 'flex-start',
                      marginBottom: '10px',
                    }}>
                      {!isMine && (
                        <div style={{ fontSize: '11px', color: C.faint, marginBottom: '3px', paddingLeft: '4px' }}>
                          {msg.sender_name}
                        </div>
                      )}
                      <div style={{
                        maxWidth: '80%', padding: '8px 12px', borderRadius: '12px',
                        borderBottomRightRadius: isMine ? '3px' : '12px',
                        borderBottomLeftRadius: isMine ? '12px' : '3px',
                        background: isMine ? C.accent : C.subtle,
                        color: isMine ? 'white' : C.text,
                        fontSize: '13px', lineHeight: '1.4',
                        border: isMine ? 'none' : `1px solid ${C.borderLight}`,
                      }}>
                        {msg.message}
                      </div>
                      <div style={{ fontSize: '10px', color: C.faint, marginTop: '3px', paddingRight: isMine ? '4px' : 0, paddingLeft: isMine ? 0 : '4px' }}>
                        {relativeTimeShort(msg.created_at)}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatMessagesEndRef} />
              </div>

              {/* Input bar */}
              <div style={{
                padding: '10px 12px', borderTop: `1px solid ${C.borderLight}`,
                display: 'flex', gap: '8px', flexShrink: 0,
              }}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  placeholder="Type a message…"
                  style={{
                    flex: 1, padding: '8px 12px',
                    border: `1px solid ${C.border}`, borderRadius: '20px',
                    fontSize: '13px', outline: 'none', background: C.subtle,
                    color: C.text,
                  }}
                  onFocus={e => e.target.style.borderColor = C.accent}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!chatInput.trim() || chatSending}
                  style={{
                    padding: '8px 14px',
                    background: chatInput.trim() ? C.accent : C.faint,
                    color: 'white', border: 'none', borderRadius: '20px',
                    fontSize: '13px', fontWeight: '600',
                    cursor: chatInput.trim() ? 'pointer' : 'not-allowed',
                    flexShrink: 0,
                  }}
                >Send</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
