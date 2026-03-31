import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io as socketIO } from 'socket.io-client';
import MapPicker from './MapPicker';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  bg:            '#0d0b10',
  card:          'rgba(255,255,255,0.032)',
  cardSolid:     '#18151f',
  subtle:        'rgba(255,255,255,0.018)',
  border:        'rgba(255,255,255,0.08)',
  borderLight:   'rgba(255,255,255,0.05)',
  accent:        '#f0a030',
  accentDark:    '#cc8820',
  accentGlow:    'rgba(240,160,48,0.28)',
  accentDim:     'rgba(240,160,48,0.12)',
  text:          '#f0ece4',
  muted:         'rgba(240,236,228,0.55)',
  faint:         'rgba(240,236,228,0.3)',
  successBg:     'rgba(74,222,128,0.08)',
  successBorder: 'rgba(74,222,128,0.2)',
  successText:   '#4ade80',
  errorBg:       'rgba(251,113,133,0.08)',
  errorBorder:   'rgba(251,113,133,0.2)',
  errorText:     '#fb7185',
  infoBg:        'rgba(96,165,250,0.08)',
  infoBorder:    'rgba(96,165,250,0.2)',
  infoText:      '#60a5fa',
};

// ── Route Preview Map (Feature 9) ─────────────────────────────────────────────
function FitBounds({ latLngs }) {
  const map = useMap();
  useEffect(() => { if (latLngs.length > 0) map.fitBounds(latLngs, { padding: [20, 20] }); }, []);
  return null;
}

function RoutePreviewMap({ coordinates, pickupLat, pickupLng }) {
  const latLngs = coordinates.map(c => [c[1], c[0]]);
  const mid     = latLngs[Math.floor(latLngs.length / 2)] || [8.5241, 76.9366];
  return (
    <MapContainer
      center={mid} zoom={13}
      style={{ height: '200px', borderRadius: '10px', marginBottom: '14px' }}
      scrollWheelZoom={false} dragging={false} zoomControl={false} attributionControl={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      <FitBounds latLngs={latLngs} />
      <Polyline positions={latLngs} color="#f0a030" weight={3} opacity={0.95} />
      {pickupLat && pickupLng && (
        <CircleMarker
          center={[pickupLat, pickupLng]} radius={7}
          color="#0d0b10" fillColor="#f0a030" fillOpacity={1} weight={2}
        />
      )}
    </MapContainer>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
export default function Dashboard({ token, role, onLogout }) {
  const [pickupLocation, setPickupLocation] = useState(null);
  const [departureTime,  setDepartureTime]  = useState('');
  const [seats,          setSeats]          = useState(1);
  const [message,        setMessage]        = useState('');
  const [messageType,    setMessageType]    = useState('success');
  const [matches,        setMatches]        = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [requests,       setRequests]       = useState([]);
  const [myStatus,       setMyStatus]       = useState([]);
  const [myRides,        setMyRides]        = useState([]);

  // Batch 1 state
  const [pendingRatings,   setPendingRatings]   = useState([]);
  const [dismissedRatings, setDismissedRatings] = useState(new Set());
  const [history,          setHistory]          = useState([]);
  const [confirmedPassengers, setConfirmedPassengers] = useState({});
  const [expandedRideId,   setExpandedRideId]   = useState(null);
  const [activeTab,        setActiveTab]        = useState('main');
  const [ratingStars,      setRatingStars]      = useState(0);
  const [ratingHover,      setRatingHover]      = useState(0);

  // Batch 2 state
  const [notifications,      setNotifications]      = useState([]);
  const [unreadCount,        setUnreadCount]        = useState(0);
  const [showNotifDropdown,  setShowNotifDropdown]  = useState(false);
  const [polylines,          setPolylines]          = useState({});
  const [expandedMatchId,    setExpandedMatchId]    = useState(null);
  const [filters,            setFilters]            = useState({ maxDist: 5000, timeWindow: null, minScore: 0, minRating: 0 });
  const notifRef = useRef(null);

  // Batch 3 state
  const [analytics, setAnalytics] = useState(null);

  // Toast
  const [toast, setToast]        = useState(null);
  const toastTimerRef            = useRef(null);
  const showToast = (msg, type = 'success') => {
    clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  };

  // Chat state
  const [chatOpen,     setChatOpen]     = useState(false);
  const [chatRideId,   setChatRideId]   = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput,    setChatInput]    = useState('');
  const [chatSending,  setChatSending]  = useState(false);
  const chatMessagesEndRef = useRef(null);
  const socketRef          = useRef(null);

  const myUserId = (() => {
    try { return JSON.parse(atob(token.split('.')[1])).id; } catch { return null; }
  })();

  const SCT = { lat: 8.5241, lng: 76.9366, name: 'SCT Pappanamcode' };

  const showMessage = (msg, type = 'success') => { setMessage(msg); setMessageType(type); };

  // ── Effects ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (role === 'driver') { fetchRequests(); fetchMyRides(); fetchAnalytics(); }
    if (role === 'passenger') fetchMyStatus();
    fetchNotifications();
    fetchPendingRatings();
    fetchHistory();
    const notifInterval = setInterval(fetchNotifications, 30000);
    const rideInterval  = setInterval(() => {
      if (role === 'driver') { fetchRequests(); fetchMyRides(); }
      if (role === 'passenger') fetchMyStatus();
      fetchPendingRatings();
    }, 15000);
    return () => { clearInterval(notifInterval); clearInterval(rideInterval); };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Data fetchers ─────────────────────────────────────────────────────────────
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

  const fetchPolyline = async (rideId) => {
    if (polylines[rideId]) return;
    try {
      const res = await axios.get(`http://localhost:5000/api/rides/${rideId}/polyline`, { headers: { Authorization: token } });
      setPolylines(prev => ({ ...prev, [rideId]: res.data.coordinates }));
    } catch (err) { console.error(err); }
  };

  const handleToggleMap = async (rideId) => {
    if (expandedMatchId === rideId) { setExpandedMatchId(null); }
    else { setExpandedMatchId(rideId); await fetchPolyline(rideId); }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────────
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
    if (!departureTime)  { showMessage('Please select a departure time.', 'error'); return; }
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
    if (!departureTime)  { showMessage('Please select a departure time.', 'error'); return; }
    setLoading(true);
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
    if (expandedRideId === rideId) { setExpandedRideId(null); }
    else {
      setExpandedRideId(rideId);
      if (!confirmedPassengers[rideId]) await fetchConfirmedPassengers(rideId);
    }
  };

  // ── Socket.IO ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketIO('http://localhost:5000', { auth: { token } });
    socketRef.current = socket;
    socket.on('new_message', (msg) => { setChatMessages(prev => [...prev, msg]); });
    return () => socket.disconnect();
  }, []);

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
      await axios.post(`http://localhost:5000/api/chat/${chatRideId}`, { message: text }, { headers: { Authorization: token } });
    } catch (err) {
      console.error(err);
      setChatInput(text);
    }
    setChatSending(false);
  };

  useEffect(() => {
    if (chatMessagesEndRef.current) chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleToggleChat = () => {
    if (chatOpen) return;
    if (role === 'passenger') {
      const accepted = myStatus.find(r => r.status === 'accepted' && !['completed', 'expired'].includes(r.ride_status));
      if (accepted) handleOpenChat(accepted.ride_id);
      else setChatOpen(true);
    } else {
      setChatOpen(true);
    }
  };

  const chatableRides = role === 'driver'
    ? myRides.filter(r => ['active', 'in_progress'].includes(r.status))
    : [];

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const relativeTime = (dateStr) => {
    const diff = Math.round((new Date(dateStr) - new Date()) / 60000);
    if (diff > 0)   return `in ${diff} min`;
    if (diff > -60) return `${Math.abs(diff)} min ago`;
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const relativeTimeShort = (dateStr) => {
    const diffMs = new Date() - new Date(dateStr);
    const mins   = Math.floor(diffMs / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const renderStars = (rating) => {
    if (!rating) return '—';
    const full = Math.round(Number(rating));
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  };

  // Feature 8 — client-side filtering
  const filteredMatches = matches.filter(m => {
    if (m.pickup_distance_meters > filters.maxDist) return false;
    if (filters.timeWindow !== null) {
      if (Math.abs(m.time_diff_minutes ?? 0) > filters.timeWindow) return false;
    }
    if (m.compatibility_score < filters.minScore) return false;
    if (filters.minRating > 0 && m.driver_avg_rating !== null) {
      if (Number(m.driver_avg_rating) < filters.minRating) return false;
    }
    return true;
  });

  const activeFilterCount = [
    filters.maxDist < 5000,
    filters.timeWindow !== null,
    filters.minScore > 0,
    filters.minRating > 0,
  ].filter(Boolean).length;

  // ── Style helpers ─────────────────────────────────────────────────────────────
  const card = {
    background:   C.card,
    border:       `1px solid ${C.border}`,
    borderRadius: '14px',
    boxShadow:    '0 4px 32px rgba(0,0,0,0.25)',
  };

  const inputStyle = {
    width: '100%',
    padding: '11px 14px',
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${C.border}`,
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
    color: C.text,
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  const labelStyle = {
    display: 'block',
    fontSize: '11px',
    color: 'rgba(240,236,228,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    fontWeight: '600',
    marginBottom: '8px',
  };

  const focusInput = (e) => {
    e.target.style.borderColor = C.accent;
    e.target.style.boxShadow   = '0 0 0 3px rgba(240,160,48,0.1)';
  };
  const blurInput = (e) => {
    e.target.style.borderColor = C.border;
    e.target.style.boxShadow   = 'none';
  };

  const refreshBtn = (onClick) => (
    <button
      onClick={onClick}
      style={{
        padding: '5px 14px',
        background: 'transparent',
        border: `1px solid ${C.border}`,
        borderRadius: '20px',
        fontSize: '12px',
        color: C.faint,
        cursor: 'pointer',
        letterSpacing: '0.3px',
        transition: 'all 0.15s',
        fontFamily: 'Manrope, sans-serif',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.faint; }}
    >Refresh</button>
  );

  const statusBadge = (status) => {
    const map = {
      accepted:    { color: C.successText, bg: C.successBg,  border: C.successBorder },
      rejected:    { color: C.errorText,   bg: C.errorBg,    border: C.errorBorder   },
      pending:     { color: C.accent,      bg: C.accentDim,  border: 'rgba(240,160,48,0.2)' },
      cancelled:   { color: C.faint,       bg: C.subtle,     border: C.border        },
      active:      { color: C.accent,      bg: C.accentDim,  border: 'rgba(240,160,48,0.2)' },
      in_progress: { color: C.infoText,    bg: C.infoBg,     border: C.infoBorder    },
      completed:   { color: C.successText, bg: C.successBg,  border: C.successBorder },
      expired:     { color: C.faint,       bg: C.subtle,     border: C.border        },
    };
    const s = map[status] || map.pending;
    return (
      <span style={{
        background: s.bg, color: s.color,
        border: `1px solid ${s.border}`,
        padding: '3px 10px', borderRadius: '20px',
        fontSize: '11px', fontWeight: '700',
        letterSpacing: '0.5px', textTransform: 'uppercase',
      }}>
        {status?.replace('_', ' ')}
      </span>
    );
  };

  const currentRatingPrompt = pendingRatings.find(r => !dismissedRatings.has(`${r.ride_id}-${r.ratee_id}`));

  const tabs = [
    { key: 'main',      label: 'Main'      },
    { key: 'history',   label: 'History'   },
    ...(role === 'driver' ? [{ key: 'analytics', label: 'Analytics' }] : []),
  ];

  // ── RENDER ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg, position: 'relative', zIndex: 1 }}>

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(13,11,16,0.85)',
        backdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${C.border}`,
        padding: '0 24px', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}>
        {/* Wordmark */}
        <div style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: '22px', fontWeight: '600',
          color: C.text, letterSpacing: '-0.2px',
          lineHeight: 1,
        }}>
          Campus<span style={{ color: C.accent }}>Car</span>GO
        </div>

        {/* Nav right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Role chip */}
          <span style={{
            fontSize: '11px', color: C.accent,
            background: C.accentDim,
            border: `1px solid rgba(240,160,48,0.2)`,
            padding: '4px 10px', borderRadius: '20px',
            fontWeight: '700', letterSpacing: '0.8px', textTransform: 'uppercase',
          }}>
            {role}
          </span>

          {/* Chat button */}
          <button onClick={handleToggleChat} style={{
            padding: '7px 12px',
            background: chatOpen ? C.accentDim : 'rgba(255,255,255,0.04)',
            border: `1px solid ${chatOpen ? 'rgba(240,160,48,0.3)' : C.border}`,
            borderRadius: '8px',
            fontSize: '15px',
            color: C.muted,
            cursor: chatOpen ? 'default' : 'pointer',
            transition: 'all 0.15s',
          }}>💬</button>

          {/* Notifications */}
          <div ref={notifRef} style={{ position: 'relative' }}>
            <button onClick={handleOpenNotifications} style={{
              position: 'relative',
              padding: '7px 12px',
              background: showNotifDropdown ? C.accentDim : 'rgba(255,255,255,0.04)',
              border: `1px solid ${showNotifDropdown ? 'rgba(240,160,48,0.3)' : C.border}`,
              borderRadius: '8px',
              fontSize: '15px',
              color: C.muted,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: '-5px', right: '-5px',
                  background: C.accent, color: '#0d0b10',
                  fontSize: '10px', fontWeight: '800',
                  minWidth: '17px', height: '17px', borderRadius: '9px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 4px',
                }}>{unreadCount}</span>
              )}
            </button>

            {showNotifDropdown && (
              <div style={{
                position: 'absolute', right: 0, top: '46px', width: '320px',
                background: '#18151f',
                border: `1px solid ${C.border}`,
                borderRadius: '14px',
                boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                zIndex: 200,
                maxHeight: '360px', overflowY: 'auto',
                animation: 'scaleIn 0.2s ease both',
              }}>
                <div style={{
                  padding: '14px 16px',
                  borderBottom: `1px solid ${C.borderLight}`,
                  fontSize: '12px', fontWeight: '700',
                  color: C.text, textTransform: 'uppercase', letterSpacing: '1px',
                }}>Notifications</div>
                {notifications.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: C.faint, fontSize: '13px' }}>
                    No notifications yet.
                  </div>
                ) : notifications.map((n, i) => (
                  <div key={i} style={{
                    padding: '12px 16px',
                    borderBottom: i < notifications.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                    transition: 'background 0.1s',
                  }}>
                    <div style={{ fontSize: '13px', color: C.text, lineHeight: '1.5' }}>{n.message}</div>
                    <div style={{ fontSize: '11px', color: C.faint, marginTop: '4px' }}>{relativeTimeShort(n.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Logout */}
          <button onClick={onLogout} style={{
            padding: '7px 16px',
            background: 'transparent',
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            fontSize: '13px', fontWeight: '500',
            color: C.muted, cursor: 'pointer',
            transition: 'all 0.15s',
            fontFamily: 'Manrope, sans-serif',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.errorText; e.currentTarget.style.color = C.errorText; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
          >Sign out</button>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: '700px', margin: '0 auto', padding: '36px 20px', position: 'relative', zIndex: 1 }}>

        {/* ── Feature 4 — Rating Prompt ──────────────────────────────────── */}
        {currentRatingPrompt && (
          <div style={{
            ...card,
            padding: '22px',
            marginBottom: '24px',
            border: `1px solid rgba(240,160,48,0.3)`,
            boxShadow: `0 4px 32px rgba(0,0,0,0.3), 0 0 24px ${C.accentGlow}`,
            animation: 'fadeUp 0.4s ease both',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '10px', color: C.accent, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '700', marginBottom: '5px' }}>
                  Rate your ride
                </div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', fontWeight: '600', color: C.text }}>
                  {currentRatingPrompt.ratee_name}
                </div>
                <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>
                  Ride from {currentRatingPrompt.start_location}
                </div>
              </div>
              <button
                onClick={() => { setDismissedRatings(prev => new Set([...prev, `${currentRatingPrompt.ride_id}-${currentRatingPrompt.ratee_id}`])); setRatingStars(0); setRatingHover(0); }}
                style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '4px 6px' }}
              >×</button>
            </div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  onClick={() => setRatingStars(star)}
                  onMouseEnter={() => setRatingHover(star)}
                  onMouseLeave={() => setRatingHover(0)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '32px', padding: '0 1px',
                    color: star <= (ratingHover || ratingStars) ? C.accent : 'rgba(255,255,255,0.12)',
                    transition: 'color 0.1s, transform 0.1s',
                    transform: star <= (ratingHover || ratingStars) ? 'scale(1.15)' : 'scale(1)',
                    filter: star <= (ratingHover || ratingStars) ? `drop-shadow(0 0 6px ${C.accentGlow})` : 'none',
                  }}
                >★</button>
              ))}
            </div>
            <button
              onClick={() => ratingStars > 0 && handleRate(currentRatingPrompt.ride_id, currentRatingPrompt.ratee_id, ratingStars)}
              disabled={ratingStars === 0}
              style={{
                padding: '10px 22px',
                background: ratingStars > 0 ? C.accent : 'rgba(255,255,255,0.06)',
                color: ratingStars > 0 ? '#0d0b10' : C.faint,
                border: 'none', borderRadius: '8px',
                fontWeight: '700', fontSize: '13px',
                cursor: ratingStars > 0 ? 'pointer' : 'not-allowed',
                boxShadow: ratingStars > 0 ? `0 0 16px ${C.accentGlow}` : 'none',
                transition: 'all 0.2s',
                fontFamily: 'Manrope, sans-serif',
              }}
            >Submit rating</button>
          </div>
        )}

        {/* ── Tab bar ───────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: '4px',
          background: C.subtle,
          border: `1px solid ${C.border}`,
          borderRadius: '12px', padding: '4px',
          marginBottom: '28px',
        }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1, padding: '9px 16px',
                background: activeTab === tab.key ? C.accent : 'transparent',
                color: activeTab === tab.key ? '#0d0b10' : C.muted,
                border: 'none', borderRadius: '9px',
                fontWeight: activeTab === tab.key ? '700' : '500',
                fontSize: '13px', cursor: 'pointer',
                transition: 'all 0.2s',
                letterSpacing: '0.2px',
                fontFamily: 'Manrope, sans-serif',
                boxShadow: activeTab === tab.key ? `0 0 14px ${C.accentGlow}` : 'none',
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* ═══════════════════ MAIN TAB ═══════════════════════════════════════ */}
        {activeTab === 'main' && (
          <>
            {/* Section heading */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '10px', color: C.accent, textTransform: 'uppercase', letterSpacing: '2.5px', fontWeight: '700', marginBottom: '6px' }}>
                {role === 'driver' ? 'Driver' : 'Passenger'}
              </div>
              <h1 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '30px', fontWeight: '600', color: C.text, lineHeight: 1.15 }}>
                {role === 'driver' ? 'Share your route' : 'Find your ride'}
              </h1>
              <p style={{ color: C.muted, marginTop: '6px', fontSize: '13px', lineHeight: 1.6 }}>
                {role === 'driver'
                  ? 'Post your morning route to SCT and pick up passengers along the way.'
                  : 'Find a driver heading to SCT that passes near you.'}
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
                  padding: '11px 14px',
                  border: `1px solid ${C.border}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: C.faint,
                  background: C.subtle,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>SCT Pappanamcode</span>
                  <span style={{
                    fontSize: '10px', color: C.accent,
                    background: C.accentDim,
                    padding: '2px 8px', borderRadius: '10px',
                    fontWeight: '700', letterSpacing: '0.5px',
                  }}>FIXED</span>
                </div>
              </div>

              <div style={{ marginBottom: '18px' }}>
                <label style={labelStyle}>Departure time</label>
                <input
                  type="datetime-local" value={departureTime}
                  onChange={e => setDepartureTime(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'dark' }}
                  onFocus={focusInput} onBlur={blurInput}
                />
              </div>

              {role === 'driver' && (
                <div style={{ marginBottom: '18px' }}>
                  <label style={labelStyle}>Available seats</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {[1, 2, 3, 4, 5, 6].map(n => (
                      <button key={n} onClick={() => setSeats(n)} style={{
                        width: '42px', height: '42px',
                        border: `1px solid ${seats === n ? C.accent : C.border}`,
                        borderRadius: '8px',
                        background: seats === n ? C.accent : C.subtle,
                        color: seats === n ? '#0d0b10' : C.muted,
                        fontWeight: '700', fontSize: '15px', cursor: 'pointer',
                        transition: 'all 0.15s',
                        boxShadow: seats === n ? `0 0 12px ${C.accentGlow}` : 'none',
                        fontFamily: 'Manrope, sans-serif',
                      }}>{n}</button>
                    ))}
                  </div>
                </div>
              )}

              {message && (
                <div style={{
                  padding: '11px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '13px',
                  background: messageType === 'success' ? C.successBg : C.errorBg,
                  border: `1px solid ${messageType === 'success' ? C.successBorder : C.errorBorder}`,
                  color: messageType === 'success' ? C.successText : C.errorText,
                }}>{message}</div>
              )}

              <button
                onClick={role === 'driver' ? handlePostRide : handleFindRides}
                disabled={loading}
                style={{
                  width: '100%', padding: '13px',
                  background: loading ? 'rgba(240,160,48,0.3)' : C.accent,
                  color: loading ? 'rgba(13,11,16,0.5)' : '#0d0b10',
                  border: 'none', borderRadius: '9px',
                  fontSize: '14px', fontWeight: '700',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: loading ? 'none' : `0 0 20px ${C.accentGlow}`,
                  letterSpacing: '0.2px',
                  fontFamily: 'Manrope, sans-serif',
                }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.boxShadow = `0 0 32px ${C.accentGlow}`; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.boxShadow = `0 0 20px ${C.accentGlow}`; }}
              >
                {loading ? 'Please wait…' : role === 'driver' ? 'Post ride' : 'Find rides'}
              </button>
            </div>

            {/* ── Driver: My Posted Rides ──────────────────────────────────── */}
            {role === 'driver' && (
              <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontSize: '10px', color: C.accent, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '700', marginBottom: '3px' }}>Your rides</div>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', fontWeight: '600', color: C.text }}>
                      Posted rides{' '}
                      {myRides.length > 0 && (
                        <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: '14px', color: C.faint, fontWeight: '400' }}>({myRides.length})</span>
                      )}
                    </div>
                  </div>
                  {refreshBtn(fetchMyRides)}
                </div>

                {myRides.length === 0 ? (
                  <div style={{ ...card, padding: '32px', textAlign: 'center', color: C.faint, fontSize: '13px' }}>
                    No rides posted yet.
                  </div>
                ) : myRides.map((r, i) => (
                  <div key={i} style={{
                    ...card,
                    padding: '18px',
                    marginBottom: '10px',
                    borderLeft: `3px solid ${r.status === 'in_progress' ? C.infoText : r.status === 'active' ? C.accent : r.status === 'completed' ? C.successText : C.border}`,
                    animation: `fadeUp 0.35s ${i * 0.05}s ease both`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>
                          {r.start_location} → SCT
                        </div>
                        <div style={{ color: C.muted, fontSize: '13px', marginTop: '3px' }}>
                          {new Date(r.departure_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                          <span style={{ fontSize: '12px', color: C.faint }}>
                            {r.available_seats} seat{r.available_seats !== 1 ? 's' : ''}
                          </span>
                          {statusBadge(r.status)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        <button onClick={() => handleTogglePassengers(r.id)} style={{
                          padding: '7px 12px',
                          background: expandedRideId === r.id ? C.accentDim : C.subtle,
                          border: `1px solid ${expandedRideId === r.id ? 'rgba(240,160,48,0.3)' : C.border}`,
                          borderRadius: '7px',
                          fontSize: '12px',
                          color: expandedRideId === r.id ? C.accent : C.muted,
                          cursor: 'pointer',
                          fontFamily: 'Manrope, sans-serif',
                          fontWeight: '500',
                        }}>
                          {expandedRideId === r.id ? 'Hide' : 'Passengers'}
                        </button>
                        <button onClick={() => handleDeleteRide(r.id)} style={{
                          padding: '7px 12px',
                          background: 'transparent',
                          border: `1px solid ${C.errorBorder}`,
                          borderRadius: '7px',
                          fontSize: '12px', fontWeight: '500',
                          color: C.errorText, cursor: 'pointer',
                          fontFamily: 'Manrope, sans-serif',
                        }}>Delete</button>
                      </div>
                    </div>

                    {expandedRideId === r.id && (
                      <div style={{ borderTop: `1px solid ${C.borderLight}`, paddingTop: '14px' }}>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                          {r.status === 'active' && (
                            <button onClick={() => handleStartRide(r.id)} style={{
                              padding: '9px 18px',
                              background: C.accent, color: '#0d0b10',
                              border: 'none', borderRadius: '8px',
                              fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                              boxShadow: `0 0 14px ${C.accentGlow}`,
                              fontFamily: 'Manrope, sans-serif',
                            }}>Mark as Started</button>
                          )}
                          {r.status === 'in_progress' && (
                            <button onClick={() => handleCompleteRide(r.id)} style={{
                              padding: '9px 18px',
                              background: C.successText, color: '#0d0b10',
                              border: 'none', borderRadius: '8px',
                              fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                              boxShadow: '0 0 14px rgba(74,222,128,0.3)',
                              fontFamily: 'Manrope, sans-serif',
                            }}>Mark as Completed</button>
                          )}
                        </div>

                        {!confirmedPassengers[r.id] ? (
                          <div style={{ color: C.faint, fontSize: '13px' }}>Loading passengers…</div>
                        ) : confirmedPassengers[r.id].length === 0 ? (
                          <div style={{ color: C.faint, fontSize: '13px' }}>No confirmed passengers yet.</div>
                        ) : (
                          <>
                            <div style={{ fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                              Confirmed ({confirmedPassengers[r.id].length})
                            </div>
                            {confirmedPassengers[r.id].map((p, pi) => (
                              <div key={pi} style={{
                                background: C.subtle,
                                borderRadius: '8px', padding: '10px 12px',
                                marginBottom: '6px',
                                border: `1px solid ${C.borderLight}`,
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              }}>
                                <div>
                                  <div style={{ fontWeight: '600', fontSize: '14px', color: C.text }}>
                                    <span style={{ color: C.accent, marginRight: '6px', fontSize: '12px' }}>{pi + 1}.</span>
                                    {p.passenger_name}
                                  </div>
                                  <div style={{ color: C.muted, fontSize: '12px', marginTop: '2px' }}>{p.pickup_location}</div>
                                </div>
                                <div style={{ fontSize: '12px', color: C.faint, fontWeight: '600' }}>
                                  {p.pickup_distance_m != null ? `${Math.round(p.pickup_distance_m)}m` : ''}
                                </div>
                              </div>
                            ))}
                            <div style={{ fontSize: '12px', color: C.muted, marginTop: '8px', padding: '8px 12px', background: C.subtle, borderRadius: '6px', border: `1px solid ${C.borderLight}` }}>
                              Est. total detour: ~{Math.round(confirmedPassengers[r.id].reduce((sum, p) => sum + (p.pickup_distance_m || 0) * 2, 0))}m
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Driver: Incoming Requests ──────────────────────────────────── */}
            {role === 'driver' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontSize: '10px', color: C.accent, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '700', marginBottom: '3px' }}>Inbox</div>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', fontWeight: '600', color: C.text, display: 'flex', alignItems: 'center', gap: '10px' }}>
                      Incoming requests
                      {requests.length > 0 && (
                        <span style={{
                          fontFamily: 'Manrope, sans-serif',
                          background: C.accent, color: '#0d0b10',
                          fontSize: '11px', fontWeight: '800',
                          padding: '2px 8px', borderRadius: '10px',
                        }}>{requests.length}</span>
                      )}
                    </div>
                  </div>
                  {refreshBtn(fetchRequests)}
                </div>

                {requests.length === 0 ? (
                  <div style={{ ...card, padding: '28px', textAlign: 'center', color: C.faint, fontSize: '13px' }}>
                    No pending requests.
                  </div>
                ) : requests.map((r, i) => (
                  <div key={i} style={{
                    ...card,
                    padding: '18px',
                    marginBottom: '10px',
                    border: `1px solid rgba(240,160,48,0.2)`,
                    boxShadow: `0 4px 24px rgba(0,0,0,0.2), 0 0 0 1px rgba(240,160,48,0.05)`,
                    animation: `fadeUp 0.35s ${i * 0.05}s ease both`,
                  }}>
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ fontWeight: '700', fontSize: '15px', color: C.text }}>{r.passenger_name}</div>
                      <div style={{ color: C.muted, fontSize: '13px', marginTop: '3px' }}>Pickup: {r.pickup_location}</div>
                      <div style={{ color: C.faint, fontSize: '12px', marginTop: '2px' }}>
                        {new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <button onClick={() => handleRespond(r.id, 'accepted')} style={{
                        padding: '10px',
                        background: C.accent, color: '#0d0b10',
                        border: 'none', borderRadius: '8px',
                        fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                        boxShadow: `0 0 14px ${C.accentGlow}`,
                        fontFamily: 'Manrope, sans-serif',
                      }}>Accept</button>
                      <button onClick={() => handleRespond(r.id, 'rejected')} style={{
                        padding: '10px',
                        background: 'transparent', color: C.errorText,
                        border: `1px solid ${C.errorBorder}`,
                        borderRadius: '8px',
                        fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                        fontFamily: 'Manrope, sans-serif',
                      }}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Passenger: Confirmed Ride Card (Feature 1) ──────────────── */}
            {role === 'passenger' && (() => {
              const acceptedRide = myStatus.find(r => r.status === 'accepted' && !['completed', 'expired'].includes(r.ride_status));
              return acceptedRide ? (
                <div style={{
                  ...card,
                  padding: '22px',
                  marginBottom: '24px',
                  border: `1px solid ${C.successBorder}`,
                  boxShadow: `0 4px 32px rgba(0,0,0,0.3), 0 0 24px rgba(74,222,128,0.08)`,
                  animation: 'fadeUp 0.4s ease both',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: '700', color: C.successText, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '5px' }}>
                        Ride confirmed
                      </div>
                      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '24px', fontWeight: '600', color: C.text }}>
                        {acceptedRide.driver_name}
                      </div>
                      <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>From {acceptedRide.start_location}</div>
                    </div>
                    {acceptedRide.driver_avg_rating && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: C.accent, fontSize: '16px' }}>{renderStars(acceptedRide.driver_avg_rating)}</div>
                        <div style={{ color: C.faint, fontSize: '11px', marginTop: '2px' }}>{Number(acceptedRide.driver_avg_rating).toFixed(1)} avg</div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                    <div style={{ background: C.subtle, borderRadius: '8px', padding: '12px', border: `1px solid ${C.borderLight}` }}>
                      <div style={{ fontSize: '10px', color: C.faint, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Pickup</div>
                      <div style={{ fontSize: '13px', color: C.text, fontWeight: '600' }}>{acceptedRide.pickup_location}</div>
                    </div>
                    <div style={{ background: C.subtle, borderRadius: '8px', padding: '12px', border: `1px solid ${C.borderLight}` }}>
                      <div style={{ fontSize: '10px', color: C.faint, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Departure</div>
                      <div style={{ fontSize: '13px', color: C.text, fontWeight: '600' }}>
                        {new Date(acceptedRide.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div style={{ fontSize: '11px', color: C.successText, marginTop: '2px' }}>{relativeTime(acceptedRide.departure_time)}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCancelRequest(acceptedRide.id)}
                    style={{
                      width: '100%', padding: '10px',
                      background: 'transparent', color: C.errorText,
                      border: `1px solid ${C.errorBorder}`,
                      borderRadius: '8px',
                      fontWeight: '600', fontSize: '13px', cursor: 'pointer',
                      fontFamily: 'Manrope, sans-serif',
                    }}
                  >Cancel ride</button>
                </div>
              ) : null;
            })()}

            {/* ── Passenger: Search Filters (Feature 8) ───────────────────── */}
            {role === 'passenger' && matches.length > 0 && (
              <div style={{ ...card, padding: '18px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: C.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1.5px', color: C.muted }}>Filters</span>
                    {activeFilterCount > 0 && (
                      <span style={{
                        background: C.accent, color: '#0d0b10',
                        fontSize: '10px', fontWeight: '800',
                        padding: '2px 7px', borderRadius: '10px',
                      }}>{activeFilterCount}</span>
                    )}
                  </div>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={() => setFilters({ maxDist: 5000, timeWindow: null, minScore: 0, minRating: 0 })}
                      style={{ background: 'none', border: 'none', color: C.accent, fontSize: '12px', cursor: 'pointer', fontWeight: '600', fontFamily: 'Manrope, sans-serif' }}
                    >Reset</button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: '6px' }}>
                      Distance: {filters.maxDist >= 5000 ? 'Any' : `${filters.maxDist}m`}
                    </label>
                    <input type="range" min="500" max="5000" step="500"
                      value={filters.maxDist}
                      onChange={e => setFilters(f => ({ ...f, maxDist: Number(e.target.value) }))}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div>
                    <label style={{ ...labelStyle, marginBottom: '6px' }}>
                      Min score: {filters.minScore > 0 ? `${filters.minScore}%` : 'Any'}
                    </label>
                    <input type="range" min="0" max="100" step="10"
                      value={filters.minScore}
                      onChange={e => setFilters(f => ({ ...f, minScore: Number(e.target.value) }))}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Departure window</label>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {[null, 30, 60, 90].map(w => (
                        <button key={String(w)}
                          onClick={() => setFilters(f => ({ ...f, timeWindow: w }))}
                          style={{
                            padding: '5px 10px', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
                            border: `1px solid ${filters.timeWindow === w ? C.accent : C.border}`,
                            background: filters.timeWindow === w ? C.accentDim : 'transparent',
                            color: filters.timeWindow === w ? C.accent : C.muted,
                            fontWeight: filters.timeWindow === w ? '700' : '400',
                            fontFamily: 'Manrope, sans-serif',
                            transition: 'all 0.15s',
                          }}
                        >{w === null ? 'Any' : `±${w}m`}</button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>Min driver rating</label>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {[0, 1, 2, 3, 4, 5].map(r => (
                        <button key={r}
                          onClick={() => setFilters(f => ({ ...f, minRating: r }))}
                          style={{
                            padding: '5px 10px', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
                            border: `1px solid ${filters.minRating === r ? C.accent : C.border}`,
                            background: filters.minRating === r ? C.accentDim : 'transparent',
                            color: filters.minRating === r ? C.accent : C.muted,
                            fontWeight: filters.minRating === r ? '700' : '400',
                            fontFamily: 'Manrope, sans-serif',
                            transition: 'all 0.15s',
                          }}
                        >{r === 0 ? 'Any' : `${r}★`}</button>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '12px', fontSize: '12px', color: C.faint }}>
                  Showing {filteredMatches.length} of {matches.length} ride{matches.length !== 1 ? 's' : ''}
                </div>
              </div>
            )}

            {/* ── Passenger: Match Results ─────────────────────────────────── */}
            {role === 'passenger' && matches.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', fontWeight: '600', color: C.text }}>
                    {filteredMatches.length} ride{filteredMatches.length !== 1 ? 's' : ''} found
                  </div>
                </div>

                {filteredMatches.map((m, i) => {
                  const scoreColor  = m.compatibility_score >= 60 ? C.successText : m.compatibility_score >= 35 ? C.accent : C.errorText;
                  const confColor   = m.confidence === 'high' ? C.successText : m.confidence === 'medium' ? C.accent : C.errorText;
                  const confBg      = m.confidence === 'high' ? C.successBg : m.confidence === 'medium' ? C.accentDim : C.errorBg;
                  const fullyBooked = m.available_seats === 0;

                  return (
                    <div key={i} style={{
                      ...card,
                      padding: '20px',
                      marginBottom: '12px',
                      animation: `fadeUp 0.35s ${i * 0.06}s ease both`,
                    }}>
                      {/* Card header: score circle + driver info */}
                      <div style={{ display: 'flex', gap: '16px', marginBottom: '14px', alignItems: 'flex-start' }}>
                        {/* Score circle */}
                        <div style={{
                          width: '58px', height: '58px', flexShrink: 0,
                          borderRadius: '50%',
                          border: `2px solid ${scoreColor}`,
                          background: `${scoreColor}10`,
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          boxShadow: `0 0 16px ${scoreColor}30`,
                        }}>
                          <div style={{ fontSize: '17px', fontWeight: '800', color: scoreColor, lineHeight: 1, fontFamily: 'Manrope, sans-serif' }}>
                            {m.compatibility_score}
                          </div>
                          <div style={{ fontSize: '8px', color: C.faint, letterSpacing: '0.5px', textTransform: 'uppercase', marginTop: '1px' }}>pts</div>
                        </div>

                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontWeight: '700', fontSize: '15px', color: C.text }}>{m.driver_name}</div>
                              <div style={{ color: C.muted, fontSize: '12px', marginTop: '2px' }}>From {m.start_location}</div>
                              {m.driver_avg_rating && (
                                <div style={{ color: C.accent, fontSize: '12px', marginTop: '3px' }}>
                                  {'★'.repeat(Math.round(m.driver_avg_rating))}{'☆'.repeat(5 - Math.round(m.driver_avg_rating))}{' '}
                                  <span style={{ color: C.faint, fontSize: '11px' }}>{Number(m.driver_avg_rating).toFixed(1)}</span>
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                              <span style={{
                                background: confBg, color: confColor,
                                border: `1px solid ${confColor}30`,
                                padding: '3px 9px', borderRadius: '20px',
                                fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px',
                              }}>{m.confidence}</span>
                              {fullyBooked && (
                                <span style={{
                                  background: C.errorBg, color: C.errorText,
                                  border: `1px solid ${C.errorBorder}`,
                                  padding: '3px 9px', borderRadius: '20px',
                                  fontSize: '10px', fontWeight: '700', textTransform: 'uppercase',
                                }}>Fully Booked</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Info chips */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                        {[
                          { icon: '🕐', text: m.time_label || new Date(m.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), highlight: true },
                          { icon: '💺', text: `${m.available_seats} seat${m.available_seats !== 1 ? 's' : ''}` },
                          { icon: '📍', text: m.distance_label || `${m.pickup_distance_meters}m away` },
                          { icon: '🛣️', text: m.detour_label || 'On route' },
                          { icon: '📌', text: m.position_label || '' },
                        ].filter(c => c.text).map((chip, j) => (
                          <span key={j} style={{
                            background: chip.highlight ? C.accentDim : C.subtle,
                            border: `1px solid ${chip.highlight ? 'rgba(240,160,48,0.2)' : C.borderLight}`,
                            padding: '5px 10px', borderRadius: '20px',
                            fontSize: '11px',
                            color: chip.highlight ? C.accent : C.muted,
                            fontWeight: chip.highlight ? '600' : '400',
                            whiteSpace: 'nowrap',
                          }}>{chip.icon} {chip.text}</span>
                        ))}
                      </div>

                      {/* Score breakdown */}
                      {m.score_breakdown && (
                        <div style={{
                          background: C.subtle, borderRadius: '10px', padding: '14px',
                          marginBottom: '14px', border: `1px solid ${C.borderLight}`,
                        }}>
                          <div style={{ fontSize: '10px', color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '700', marginBottom: '10px' }}>
                            Score breakdown
                          </div>
                          {[
                            { label: 'Detour Cost',     value: m.score_breakdown.detour,    weight: '40%' },
                            { label: 'Route Position',  value: m.score_breakdown.position,  weight: '25%' },
                            { label: 'Time Match',      value: m.score_breakdown.time,      weight: '20%' },
                            { label: 'Proximity',       value: m.score_breakdown.proximity, weight: '15%' },
                          ].map((bar, k) => {
                            const barColor = bar.value >= 60 ? C.successText : bar.value >= 35 ? C.accent : C.errorText;
                            return (
                              <div key={k} style={{ marginBottom: k < 3 ? '8px' : 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                                  <span style={{ color: C.faint }}>
                                    {bar.label} <span style={{ color: 'rgba(240,236,228,0.2)', fontSize: '10px' }}>({bar.weight})</span>
                                  </span>
                                  <span style={{ fontWeight: '700', color: barColor }}>{bar.value}%</span>
                                </div>
                                <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div style={{
                                    width: `${bar.value}%`, height: '100%', borderRadius: '2px',
                                    background: barColor,
                                    boxShadow: `0 0 6px ${barColor}80`,
                                    transition: 'width 0.6s ease',
                                  }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Map toggle (Feature 9) */}
                      <button
                        onClick={() => handleToggleMap(m.ride_id)}
                        style={{
                          width: '100%', padding: '9px', marginBottom: '10px',
                          background: expandedMatchId === m.ride_id ? C.accentDim : C.subtle,
                          color: expandedMatchId === m.ride_id ? C.accent : C.faint,
                          border: `1px solid ${expandedMatchId === m.ride_id ? 'rgba(240,160,48,0.25)' : C.borderLight}`,
                          borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
                          transition: 'all 0.15s',
                          fontFamily: 'Manrope, sans-serif',
                          fontWeight: '500',
                          letterSpacing: '0.3px',
                        }}
                      >
                        {expandedMatchId === m.ride_id ? '▲ Hide map' : '▼ Show map'}
                      </button>

                      {expandedMatchId === m.ride_id && polylines[m.ride_id] && (
                        <RoutePreviewMap
                          coordinates={polylines[m.ride_id]}
                          pickupLat={pickupLocation?.lat}
                          pickupLng={pickupLocation?.lng}
                        />
                      )}
                      {expandedMatchId === m.ride_id && !polylines[m.ride_id] && (
                        <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: '13px', marginBottom: '12px', background: C.subtle, borderRadius: '10px' }}>
                          Loading map…
                        </div>
                      )}

                      {/* Request button (Feature 10) */}
                      <button
                        onClick={() => !fullyBooked && handleRequestRide(m)}
                        disabled={fullyBooked}
                        style={{
                          width: '100%', padding: '12px',
                          background: fullyBooked ? 'rgba(255,255,255,0.04)' : C.accent,
                          color: fullyBooked ? C.faint : '#0d0b10',
                          border: fullyBooked ? `1px solid ${C.border}` : 'none',
                          borderRadius: '9px',
                          fontWeight: '700', fontSize: '14px',
                          cursor: fullyBooked ? 'not-allowed' : 'pointer',
                          boxShadow: fullyBooked ? 'none' : `0 0 20px ${C.accentGlow}`,
                          transition: 'all 0.2s',
                          fontFamily: 'Manrope, sans-serif',
                          letterSpacing: '0.2px',
                        }}
                        onMouseEnter={e => { if (!fullyBooked) e.currentTarget.style.boxShadow = `0 0 30px ${C.accentGlow}`; }}
                        onMouseLeave={e => { if (!fullyBooked) e.currentTarget.style.boxShadow = `0 0 20px ${C.accentGlow}`; }}
                      >
                        {fullyBooked ? 'Fully Booked' : 'Request ride'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Passenger empty state */}
            {role === 'passenger' && matches.length === 0 && myStatus.length === 0 && !message && (
              <div style={{ ...card, padding: '40px 32px', textAlign: 'center' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>🚗</div>
                <div style={{ color: C.muted, fontSize: '14px', lineHeight: 1.6 }}>
                  Enter your pickup location and departure time,<br />
                  then tap <strong style={{ color: C.text }}>Find rides</strong>.
                </div>
              </div>
            )}

            {/* ── Passenger: My Requests ─────────────────────────────────── */}
            {role === 'passenger' && myStatus.length > 0 && (
              <div style={{ marginTop: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontSize: '10px', color: C.accent, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '700', marginBottom: '3px' }}>Status</div>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '22px', fontWeight: '600', color: C.text }}>My requests</div>
                  </div>
                  {refreshBtn(fetchMyStatus)}
                </div>
                {myStatus.map((r, i) => {
                  if (r.status === 'accepted' && !['completed', 'expired'].includes(r.ride_status)) return null;
                  return (
                    <div key={i} style={{
                      ...card,
                      padding: '16px',
                      marginBottom: '8px',
                      borderLeft: `3px solid ${r.status === 'accepted' ? C.successText : r.status === 'pending' ? C.accent : r.status === 'rejected' ? C.errorText : C.faint}`,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{r.driver_name}</div>
                        <div style={{ color: C.muted, fontSize: '13px', marginTop: '2px' }}>From: {r.start_location}</div>
                        <div style={{ color: C.faint, fontSize: '12px', marginTop: '2px' }}>
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

        {/* ═══════════════════ HISTORY TAB ════════════════════════════════════ */}
        {activeTab === 'history' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <div style={{ fontSize: '10px', color: C.accent, textTransform: 'uppercase', letterSpacing: '2.5px', fontWeight: '700', marginBottom: '5px' }}>Past rides</div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '28px', fontWeight: '600', color: C.text }}>Ride history</div>
              </div>
              {refreshBtn(fetchHistory)}
            </div>

            {history.length === 0 ? (
              <div style={{ ...card, padding: '40px', textAlign: 'center' }}>
                <div style={{ fontSize: '28px', marginBottom: '10px' }}>📋</div>
                <div style={{ color: C.faint, fontSize: '13px' }}>No completed rides yet.</div>
              </div>
            ) : history.map((h, i) => (
              <div key={i} style={{
                ...card, padding: '18px', marginBottom: '10px',
                animation: `fadeUp 0.35s ${i * 0.05}s ease both`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: C.text }}>{h.start_location} → SCT</div>
                    <div style={{ color: C.muted, fontSize: '12px', marginTop: '3px' }}>
                      {new Date(h.departure_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  </div>
                  {statusBadge(h.status || 'completed')}
                </div>

                {role === 'driver' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '12px', color: C.muted, paddingTop: '8px', borderTop: `1px solid ${C.borderLight}` }}>
                    {h.passenger_count != null && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>👥</span>
                        <span>{h.passenger_count} passenger{Number(h.passenger_count) !== 1 ? 's' : ''}</span>
                      </span>
                    )}
                    {h.avg_rating_received != null && (
                      <span style={{ color: C.accent, fontWeight: '600' }}>
                        ★ {Number(h.avg_rating_received).toFixed(1)} avg rating
                      </span>
                    )}
                    {h.ratings_given && h.ratings_given.length > 0 && (
                      <div style={{ width: '100%', marginTop: '4px' }}>
                        <div style={{ fontSize: '11px', color: C.faint, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Rated:</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {h.ratings_given.map((rg, j) => (
                            <span key={j} style={{
                              fontSize: '12px', color: C.muted,
                              background: C.subtle, padding: '3px 10px', borderRadius: '20px',
                              border: `1px solid ${C.borderLight}`,
                            }}>
                              {rg.ratee_name}: <span style={{ color: C.accent }}>{'★'.repeat(rg.stars)}</span>{'☆'.repeat(5 - rg.stars)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {role === 'passenger' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '12px', paddingTop: '8px', borderTop: `1px solid ${C.borderLight}` }}>
                    {h.driver_name && <span style={{ color: C.muted }}>Driver: <span style={{ color: C.text, fontWeight: '600' }}>{h.driver_name}</span></span>}
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

        {/* ═══════════════════ ANALYTICS TAB ══════════════════════════════════ */}
        {activeTab === 'analytics' && role === 'driver' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <div style={{ fontSize: '10px', color: C.accent, textTransform: 'uppercase', letterSpacing: '2.5px', fontWeight: '700', marginBottom: '5px' }}>Performance</div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '28px', fontWeight: '600', color: C.text }}>Your stats</div>
              </div>
              {refreshBtn(fetchAnalytics)}
            </div>

            {!analytics ? (
              <div style={{ ...card, padding: '40px', textAlign: 'center' }}>
                <div style={{ fontSize: '28px', marginBottom: '10px' }}>📊</div>
                <div style={{ color: C.faint, fontSize: '13px' }}>No analytics yet. Post and complete rides to see your stats.</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {[
                  {
                    label: 'Total rides given',
                    value: analytics.total_rides ?? 0,
                    display: String(analytics.total_rides ?? 0),
                    color: C.accent,
                  },
                  {
                    label: 'Total passengers',
                    value: analytics.total_passengers ?? 0,
                    display: String(analytics.total_passengers ?? 0),
                    color: C.infoText,
                  },
                  {
                    label: 'Avg compatibility',
                    value: analytics.avg_score,
                    display: analytics.avg_score != null ? `${Math.round(analytics.avg_score)}` : '—',
                    suffix: analytics.avg_score != null ? '%' : '',
                    color: C.successText,
                  },
                  {
                    label: 'Avg rating received',
                    value: analytics.avg_rating,
                    display: analytics.avg_rating != null ? Number(analytics.avg_rating).toFixed(1) : '—',
                    stars: analytics.avg_rating,
                    color: C.accent,
                  },
                ].map((stat, i) => (
                  <div key={i} style={{
                    ...card,
                    padding: '22px',
                    animation: `fadeUp 0.4s ${i * 0.07}s ease both`,
                  }}>
                    <div style={{ fontSize: '10px', color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '700', marginBottom: '10px' }}>
                      {stat.label}
                    </div>
                    <div style={{
                      fontFamily: "'Cormorant Garamond', Georgia, serif",
                      fontSize: '52px', fontWeight: '600',
                      color: stat.color, lineHeight: 1,
                      letterSpacing: '-1px',
                    }}>
                      {stat.display}
                      {stat.suffix && <span style={{ fontSize: '24px' }}>{stat.suffix}</span>}
                    </div>
                    {stat.stars != null && (
                      <div style={{ marginTop: '8px', color: C.accent, fontSize: '16px', letterSpacing: '2px' }}>
                        {'★'.repeat(Math.round(stat.stars))}{'☆'.repeat(5 - Math.round(stat.stars))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'success' ? '#1a2e22' : '#2e1a1e',
          border: `1px solid ${toast.type === 'success' ? C.successBorder : C.errorBorder}`,
          color: toast.type === 'success' ? C.successText : C.errorText,
          padding: '12px 24px', borderRadius: '10px',
          fontSize: '13px', fontWeight: '600',
          boxShadow: `0 8px 32px rgba(0,0,0,0.4)`,
          zIndex: 2000, pointerEvents: 'none',
          maxWidth: '380px', textAlign: 'center',
          backdropFilter: 'blur(12px)',
          animation: 'fadeUp 0.3s ease both',
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── Chat Panel ────────────────────────────────────────────────────── */}
      {chatOpen && (
        <div style={{
          position: 'fixed', top: '60px', right: 0,
          width: '320px', height: 'calc(100vh - 60px)',
          background: 'rgba(18,15,22,0.95)',
          backdropFilter: 'blur(20px)',
          borderLeft: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
          zIndex: 900,
          animation: 'slideInRight 0.3s ease both',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${C.borderLight}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div style={{ fontWeight: '700', fontSize: '13px', color: C.text, textTransform: 'uppercase', letterSpacing: '1px' }}>
              Chat
            </div>
            <button onClick={() => setChatOpen(false)} style={{
              background: C.subtle,
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              color: C.muted,
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: '600',
              padding: '5px 10px',
              letterSpacing: '0.3px',
              fontFamily: 'Manrope, sans-serif',
            }}>Close Chat</button>
          </div>

          {/* Driver: ride selector */}
          {role === 'driver' && (
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.borderLight}`, flexShrink: 0 }}>
              {chatableRides.length === 0 ? (
                <div style={{ fontSize: '12px', color: C.faint, textAlign: 'center', padding: '6px 0' }}>
                  No active rides to chat in.
                </div>
              ) : (
                <select
                  value={chatRideId || ''}
                  onChange={e => { const id = Number(e.target.value); setChatRideId(id || null); setChatMessages([]); }}
                  style={{
                    width: '100%', padding: '9px 10px',
                    border: `1px solid ${C.border}`, borderRadius: '8px',
                    fontSize: '12px', color: C.text,
                    background: '#18151f', outline: 'none', cursor: 'pointer',
                    fontFamily: 'Manrope, sans-serif',
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

          {/* Passenger: no active ride */}
          {role === 'passenger' && !chatRideId && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
              <div style={{ textAlign: 'center', color: C.faint, fontSize: '13px', lineHeight: 1.6 }}>
                You need an accepted ride<br />to use chat.
              </div>
            </div>
          )}

          {/* Messages */}
          {chatRideId && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                {chatMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: C.faint, fontSize: '13px', marginTop: '24px' }}>
                    No messages yet. Say hi! 👋
                  </div>
                ) : chatMessages.map((msg, i) => {
                  const isMine = msg.sender_id === myUserId;
                  return (
                    <div key={i} style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: isMine ? 'flex-end' : 'flex-start',
                      marginBottom: '12px',
                    }}>
                      {!isMine && (
                        <div style={{ fontSize: '10px', color: C.faint, marginBottom: '3px', paddingLeft: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {msg.sender_name}
                        </div>
                      )}
                      <div style={{
                        maxWidth: '80%', padding: '9px 13px', borderRadius: '14px',
                        borderBottomRightRadius: isMine ? '3px' : '14px',
                        borderBottomLeftRadius: isMine ? '14px' : '3px',
                        background: isMine ? C.accent : 'rgba(255,255,255,0.06)',
                        color: isMine ? '#0d0b10' : C.text,
                        fontSize: '13px', lineHeight: '1.5',
                        border: isMine ? 'none' : `1px solid ${C.borderLight}`,
                        boxShadow: isMine ? `0 2px 10px ${C.accentGlow}` : 'none',
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
                padding: '10px 12px',
                borderTop: `1px solid ${C.borderLight}`,
                display: 'flex', gap: '8px', flexShrink: 0,
              }}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  placeholder="Type a message…"
                  style={{
                    flex: 1, padding: '9px 13px',
                    border: `1px solid ${C.border}`,
                    borderRadius: '20px',
                    fontSize: '13px', outline: 'none',
                    background: C.subtle, color: C.text,
                    transition: 'border-color 0.15s',
                    fontFamily: 'Manrope, sans-serif',
                  }}
                  onFocus={e => e.target.style.borderColor = C.accent}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!chatInput.trim() || chatSending}
                  style={{
                    padding: '9px 14px',
                    background: chatInput.trim() ? C.accent : 'rgba(255,255,255,0.05)',
                    color: chatInput.trim() ? '#0d0b10' : C.faint,
                    border: 'none', borderRadius: '20px',
                    fontSize: '12px', fontWeight: '700',
                    cursor: chatInput.trim() ? 'pointer' : 'not-allowed',
                    flexShrink: 0,
                    boxShadow: chatInput.trim() ? `0 0 12px ${C.accentGlow}` : 'none',
                    transition: 'all 0.15s',
                    fontFamily: 'Manrope, sans-serif',
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
