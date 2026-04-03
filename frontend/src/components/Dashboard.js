import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io as socketIO } from 'socket.io-client';
import MapPicker from './MapPicker';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';

const C = {
  bg: '#F7E7CE',
  sidebar: '#F2DDBC',
  card: '#FEFAF3',
  surface: '#F2DDBC',
  border: '#DDD0B3',
  borderLight: '#EAE0CC',
  accent: '#102C26',
  accentDark: '#0a1e1a',
  accentLight: 'rgba(16,44,38,0.10)',
  accentDim: 'rgba(16,44,38,0.05)',
  text: '#102C26',
  muted: '#4A6A5E',
  faint: '#8AAA9E',
  successText: '#1a6644',
  successBg: 'rgba(26,102,68,0.08)',
  successBorder: 'rgba(26,102,68,0.25)',
  errorText: '#a63020',
  errorBg: 'rgba(166,48,32,0.08)',
  errorBorder: 'rgba(166,48,32,0.25)',
  infoText: '#2a5a6a',
  infoBg: 'rgba(42,90,106,0.08)',
  infoBorder: 'rgba(42,90,106,0.25)',
  warningText: '#8a6020',
};

function FitBounds({ latLngs }) {
  const map = useMap();
  useEffect(() => { if (latLngs.length > 0) map.fitBounds(latLngs, { padding: [20, 20] }); }, []);
  return null;
}

function RoutePreviewMap({ coordinates, pickupLat, pickupLng }) {
  const latLngs = coordinates.map(c => [c[1], c[0]]);
  const mid = latLngs[Math.floor(latLngs.length / 2)] || [8.4682, 76.9829];
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 12, border: `1px solid ${C.border}` }}>
      <MapContainer center={mid} zoom={13} style={{ height: '200px', width: '100%' }}
        scrollWheelZoom={false} dragging={false} zoomControl={false} attributionControl={false}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        <FitBounds latLngs={latLngs} />
        <Polyline positions={latLngs} color={C.accent} weight={3} opacity={0.9} />
        {pickupLat && pickupLng && (
          <CircleMarker center={[pickupLat, pickupLng]} radius={8}
            color="#06080f" fillColor={C.accent} fillOpacity={1} weight={2} />
        )}
      </MapContainer>
    </div>
  );
}

const Ico = {
  dashboard: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  find: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  offer: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="9" y="11" width="14" height="10" rx="2"/><circle cx="12" cy="16" r="1"/></svg>,
  myrides: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  messages: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  bell: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  history: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-9.98L23 10"/></svg>,
  profile: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
};

export default function Dashboard({ token, role, onLogout }) {
  const [activePage, setActivePage] = useState('dashboard');
  const [userName, setUserName] = useState('');
  const [userRegNumber, setUserRegNumber] = useState('');
  const [totalCo2Saved, setTotalCo2Saved] = useState(0);
  const [totalDistanceKm, setTotalDistanceKm] = useState(0);
  const [platformStats, setPlatformStats] = useState(null);

  const [pickupLocation, setPickupLocation] = useState(null);
  const [departureDate, setDepartureDate] = useState('');
  const [departureTimeStr, setDepartureTimeStr] = useState('08:00');
  const [seats, setSeats] = useState(4);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');
  const [loading, setLoading] = useState(false);

  const [matches, setMatches] = useState([]);
  const [requests, setRequests] = useState([]);
  const [myStatus, setMyStatus] = useState([]);
  const [myRides, setMyRides] = useState([]);
  const [pendingRatings, setPendingRatings] = useState([]);
  const [dismissedRatings, setDismissedRatings] = useState(new Set());
  const [history, setHistory] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [confirmedPassengers, setConfirmedPassengers] = useState({});
  const [expandedRideId, setExpandedRideId] = useState(null);
  const [polylines, setPolylines] = useState({});
  const [expandedMatchId, setExpandedMatchId] = useState(null);
  const [filters, setFilters] = useState({ maxDist: 5000, timeWindow: null, minScore: 0, minRating: 0 });
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingHover, setRatingHover] = useState(0);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const [chatRideId, setChatRideId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef(null);
  const socketRef = useRef(null);

  // Live Location States
  const [liveLocations, setLiveLocations] = useState({}); // Stores incoming GPS from socket
  const [viewingLiveUser, setViewingLiveUser] = useState(null); // { id, name, role }
  const watchId = useRef(null);


  const myUserId = (() => { try { return JSON.parse(atob(token.split('.')[1])).id; } catch { return null; } })();
  const SCT = { lat: 8.4682, lng: 76.9829, name: 'SCT Pappanamcode' };
  const departureTime = departureDate && departureTimeStr ? `${departureDate}T${departureTimeStr}` : '';

  const avatarColors = ['#00dcff', '#7c3aed', '#10d98a', '#f97316', '#ff3366', '#fbbf24'];
  const getInitials = (name) => name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  const getAvatarColor = (name) => avatarColors[(name?.charCodeAt(0) || 0) % avatarColors.length];

  const showToast = (msg, type = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };
  const showMessage = (msg, type = 'success') => { setMessage(msg); setMessageType(type); };

  // ── Effects ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    axios.get('http://localhost:5000/api/auth/me', { headers: { Authorization: token } })
      .then(res => { 
        setUserName(res.data.name); 
        setUserRegNumber(res.data.reg_number);
        setTotalCo2Saved(res.data.total_co2_saved || 0);
        setTotalDistanceKm(res.data.total_distance_km || 0);
      })
      .catch(console.error);
    if (role === 'driver') { fetchRequests(); fetchMyRides(); fetchAnalytics(); }
    if (role === 'passenger') fetchMyStatus();
    fetchNotifications(); fetchPendingRatings(); fetchHistory();
    axios.get('http://localhost:5000/api/stats').then(r => setPlatformStats(r.data)).catch(() => {});
    const notifInterval = setInterval(fetchNotifications, 30000);
    const rideInterval = setInterval(() => {
      if (role === 'driver') { fetchRequests(); fetchMyRides(); }
      if (role === 'passenger') fetchMyStatus();
      fetchPendingRatings();
    }, 15000);
    return () => { clearInterval(notifInterval); clearInterval(rideInterval); };
  }, []);

  useEffect(() => {
    const socket = socketIO('http://localhost:5000', { auth: { token } });
    socketRef.current = socket;
    socket.on('new_message', msg => setChatMessages(prev => [...prev, msg]));
    socket.on('driver:location_update', data => {
      setLiveLocations(prev => ({ ...prev, driver: { lat: data.lat, lng: data.lng, timestamp: Date.now() } }));
    });
    socket.on('passenger:location_update', data => {
      setLiveLocations(prev => ({ ...prev, [data.passengerId]: { lat: data.lat, lng: data.lng, timestamp: Date.now() } }));
    });
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (!socketRef.current) return;
    if (chatRideId) { socketRef.current.emit('join_ride', chatRideId); fetchChatMessages(chatRideId); }
    return () => { if (chatRideId) socketRef.current?.emit('leave_ride', chatRideId); };
  }, [chatRideId]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    // Determine active ride ID to broadcast location for
    let activeRideId = null;
    if (role === 'driver') {
      const active = myRides.find(r => ['active', 'in_progress'].includes(r.status));
      if (active) activeRideId = active.id;
    } else {
      const accepted = myStatus.find(r => r.status === 'accepted' && !['completed', 'expired'].includes(r.ride_status));
      if (accepted) activeRideId = accepted.ride_id;
    }

    if (activeRideId && navigator.geolocation) {
      // Ensure we joined the ride socket room
      socketRef.current?.emit('join_ride', activeRideId);

      watchId.current = navigator.geolocation.watchPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        if (socketRef.current) {
          socketRef.current.emit(role === 'driver' ? 'driver:location' : 'passenger:location', {
            lat: latitude, lng: longitude, rideId: activeRideId
          });
        }
      }, err => console.warn('Geolocation error:', err), { enableHighAccuracy: true });
    }

    return () => {
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [myRides, myStatus, role]);

  // ── Fetchers ─────────────────────────────────────────────────────────────────
  const fetchRequests = async () => {
    try { const r = await axios.get('http://localhost:5000/api/rides/requests', { headers: { Authorization: token } }); setRequests(r.data.requests); } catch(e) { console.error(e); }
  };
  const fetchMyRides = async () => {
    try { const r = await axios.get('http://localhost:5000/api/rides/myrides', { headers: { Authorization: token } }); setMyRides(r.data.rides); } catch(e) { console.error(e); }
  };
  const fetchMyStatus = async () => {
    try { const r = await axios.get('http://localhost:5000/api/rides/mystatus', { headers: { Authorization: token } }); setMyStatus(r.data.requests); } catch(e) { console.error(e); }
  };
  const fetchPendingRatings = async () => {
    try { const r = await axios.get('http://localhost:5000/api/rides/pending-ratings', { headers: { Authorization: token } }); setPendingRatings(r.data.pending_ratings || []); } catch(e) { console.error(e); }
  };
  const fetchHistory = async () => {
    try { const r = await axios.get('http://localhost:5000/api/rides/history', { headers: { Authorization: token } }); setHistory(r.data.history || []); } catch(e) { console.error(e); }
  };
  const fetchAnalytics = async () => {
    try { const r = await axios.get('http://localhost:5000/api/rides/analytics', { headers: { Authorization: token } }); setAnalytics(r.data.analytics); } catch(e) { console.error(e); }
  };
  const fetchNotifications = async () => {
    try { const r = await axios.get('http://localhost:5000/api/notifications', { headers: { Authorization: token } }); setNotifications(r.data.notifications || []); setUnreadCount(r.data.unread_count || 0); } catch(e) { console.error(e); }
  };
  const fetchConfirmedPassengers = async (rideId) => {
    try { const r = await axios.get(`http://localhost:5000/api/rides/confirmed-passengers/${rideId}`, { headers: { Authorization: token } }); setConfirmedPassengers(prev => ({ ...prev, [rideId]: r.data.passengers })); } catch(e) { console.error(e); }
  };
  const fetchPolyline = async (rideId) => {
    if (polylines[rideId] !== undefined) return;
    try {
      const r = await axios.get(`http://localhost:5000/api/rides/${rideId}/polyline`, { headers: { Authorization: token } });
      setPolylines(prev => ({ ...prev, [rideId]: r.data.coordinates || false }));
    } catch(e) {
      console.error(e);
      setPolylines(prev => ({ ...prev, [rideId]: false }));
    }
  };
  const fetchChatMessages = async (rideId) => {
    if (!rideId) return;
    try { const r = await axios.get(`http://localhost:5000/api/chat/${rideId}`, { headers: { Authorization: token } }); setChatMessages(r.data.messages || []); } catch(e) { console.error(e); }
  };

  // ── Handlers ─────────────────────────────────────────────────────────────────
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
      showMessage('Ride posted successfully!', 'success');
      fetchMyRides();
    } catch(err) { showMessage(err.response?.data?.error || 'Error posting ride', 'error'); }
    setLoading(false);
  };
  const handleFindRides = async () => {
    if (!pickupLocation) { showMessage('Please select your pickup location.', 'error'); return; }
    if (!departureTime) { showMessage('Please select a departure time.', 'error'); return; }
    setLoading(true);
    setFilters({ maxDist: 5000, timeWindow: null, minScore: 0, minRating: 0 });
    setExpandedMatchId(null);
    try {
      const res = await axios.post('http://localhost:5000/api/match/find', {
        pickup_lat: pickupLocation.lat, pickup_lng: pickupLocation.lng,
        dropoff_lat: SCT.lat, dropoff_lng: SCT.lng, departure_time: departureTime,
      }, { headers: { Authorization: token } });
      setMatches(res.data.matches);
      if (!res.data.matches.length) showMessage(res.data.message || 'No rides found.', 'error');
      else setMessage('');
    } catch(err) { showMessage(err.response?.data?.error || 'Error finding rides', 'error'); }
    setLoading(false);
  };
  const handleRequestRide = async (match) => {
    if (!pickupLocation) { showToast('No pickup location selected.', 'error'); return; }
    try {
      await axios.post('http://localhost:5000/api/rides/request', {
        ride_id: match.ride_id, pickup_location: pickupLocation.name,
        dropoff_location: SCT.name, pickup_lat: pickupLocation.lat,
        pickup_lng: pickupLocation.lng, score: match.compatibility_score,
      }, { headers: { Authorization: token } });
      showToast('Ride requested! Waiting for driver.', 'success');
      fetchMyStatus();
    } catch(err) { showToast(err.response?.data?.error || 'Error requesting ride', 'error'); }
  };
  const handleRespond = async (requestId, action) => {
    try {
      await axios.post('http://localhost:5000/api/rides/respond', { request_id: requestId, action }, { headers: { Authorization: token } });
      fetchRequests(); fetchMyRides();
    } catch(err) { showToast(err.response?.data?.error || 'Error', 'error'); }
  };
  const handleCancelRequest = async (requestId) => {
    try {
      await axios.post(`http://localhost:5000/api/rides/cancel-request/${requestId}`, {}, { headers: { Authorization: token } });
      fetchMyStatus(); showToast('Ride cancelled.', 'success');
    } catch(err) { showToast(err.response?.data?.error || 'Error', 'error'); }
  };
  const handleDeleteRequest = async (requestId) => {
    if (!window.confirm('Delete this request from history?')) return;
    try {
      await axios.delete(`http://localhost:5000/api/rides/request/${requestId}`, { headers: { Authorization: token } });
      fetchMyStatus(); showToast('Request deleted.', 'success');
    } catch(err) { showToast(err.response?.data?.error || 'Error', 'error'); }
  };
  const handleStartRide = async (rideId) => {
    try {
      await axios.post(`http://localhost:5000/api/rides/start/${rideId}`, {}, { headers: { Authorization: token } });
      fetchMyRides(); if (confirmedPassengers[rideId]) fetchConfirmedPassengers(rideId);
    } catch(err) { showToast(err.response?.data?.error || 'Error', 'error'); }
  };
  const handleCompleteRide = async (rideId) => {
    try {
      await axios.post(`http://localhost:5000/api/rides/complete/${rideId}`, {}, { headers: { Authorization: token } });
      fetchMyRides(); await fetchPendingRatings(); setRatingStars(0); setRatingHover(0);
    } catch(err) { showToast(err.response?.data?.error || 'Error', 'error'); }
  };
  const handleRate = async (rideId, rateeId, stars) => {
    try {
      await axios.post('http://localhost:5000/api/rides/rate', { ride_id: rideId, ratee_id: rateeId, stars }, { headers: { Authorization: token } });
      setPendingRatings(prev => prev.filter(r => !(r.ride_id === rideId && r.ratee_id === rateeId)));
      setRatingStars(0); showToast('Rating submitted!', 'success');
    } catch(err) { showToast(err.response?.data?.error || 'Error', 'error'); }
  };
  const handleDeleteRide = async (rideId) => {
    if (!window.confirm('Delete this ride?')) return;
    try {
      await axios.delete(`http://localhost:5000/api/rides/delete/${rideId}`, { headers: { Authorization: token } });
      fetchMyRides(); showToast('Ride deleted.', 'success');
    } catch(err) { showToast(err.response?.data?.error || 'Error', 'error'); }
  };
  const handleTogglePassengers = async (rideId) => {
    if (expandedRideId === rideId) setExpandedRideId(null);
    else { setExpandedRideId(rideId); if (!confirmedPassengers[rideId]) await fetchConfirmedPassengers(rideId); }
  };
  const handleToggleMap = async (rideId) => {
    if (expandedMatchId === rideId) setExpandedMatchId(null);
    else { setExpandedMatchId(rideId); await fetchPolyline(rideId); }
  };
  const handleSendMessage = async () => {
    if (!chatInput.trim() || !chatRideId || chatSending) return;
    setChatSending(true);
    const text = chatInput.trim(); setChatInput('');
    try { await axios.post(`http://localhost:5000/api/chat/${chatRideId}`, { message: text }, { headers: { Authorization: token } }); }
    catch(err) { console.error(err); setChatInput(text); }
    setChatSending(false);
  };
  const handleMarkNotificationsRead = async () => {
    try {
      await axios.post('http://localhost:5000/api/notifications/read', {}, { headers: { Authorization: token } });
      setUnreadCount(0); setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch(e) { console.error(e); }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const relativeTime = (dateStr) => {
    const diff = Math.round((new Date(dateStr) - new Date()) / 60000);
    if (diff > 0) return `in ${diff} min`;
    if (diff > -60) return `${Math.abs(diff)} min ago`;
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const relativeTimeShort = (dateStr) => {
    const ms = new Date() - new Date(dateStr), mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };
  const renderStars = (n) => {
    if (!n) return null;
    const full = Math.round(Number(n));
    return <span><span style={{ color: '#fbbf24' }}>{'★'.repeat(full)}</span><span style={{ color: C.faint }}>{'★'.repeat(5 - full)}</span></span>;
  };

  const filteredMatches = matches.filter(m => {
    if (m.pickup_distance_meters > filters.maxDist) return false;
    if (filters.timeWindow !== null && Math.abs(m.time_diff_minutes ?? 0) > filters.timeWindow) return false;
    if (m.compatibility_score < filters.minScore) return false;
    if (filters.minRating > 0 && (m.driver_avg_rating === null || Number(m.driver_avg_rating) < filters.minRating)) return false;
    return true;
  });
  const activeFilterCount = [filters.maxDist < 5000, filters.timeWindow !== null, filters.minScore > 0, filters.minRating > 0].filter(Boolean).length;

  const statusDot = (status) => {
    const colors = { active: C.successText, in_progress: C.infoText, completed: C.muted, expired: C.faint, pending: C.warningText, accepted: C.successText, rejected: C.errorText, cancelled: C.faint };
    return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colors[status] || C.faint, marginRight: 5, flexShrink: 0, boxShadow: status === 'active' ? `0 0 6px ${C.successText}` : 'none' }} />;
  };
  const statusBadge = (status) => {
    const map = {
      accepted:    { color: '#10d98a', bg: 'rgba(16,217,138,0.08)',  border: 'rgba(16,217,138,0.25)' },
      rejected:    { color: '#ff3366', bg: 'rgba(255,51,102,0.08)',  border: 'rgba(255,51,102,0.25)' },
      pending:     { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.25)' },
      cancelled:   { color: C.muted,   bg: C.surface,                border: C.border },
      active:      { color: C.accent,  bg: C.accentDim,              border: 'rgba(0,220,255,0.3)' },
      in_progress: { color: '#60a5fa', bg: 'rgba(96,165,250,0.08)',  border: 'rgba(96,165,250,0.3)' },
      completed:   { color: '#10d98a', bg: 'rgba(16,217,138,0.08)',  border: 'rgba(16,217,138,0.25)' },
      expired:     { color: C.muted,   bg: C.surface,                border: C.border },
    };
    const s = map[status] || map.pending;
    return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{status?.replace('_', ' ')}</span>;
  };

  // ── Style helpers ─────────────────────────────────────────────────────────────
  const card = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
  };
  const inputStyle = {
    width: '100%',
    padding: '11px 14px',
    background: 'rgba(255,255,255,0.05)',
    border: `1.5px solid rgba(0,220,255,0.15)`,
    borderRadius: 10,
    fontSize: 14,
    color: C.text,
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    fontFamily: 'inherit',
  };
  const labelStyle = {
    display: 'block', fontSize: 11, color: C.faint,
    textTransform: 'uppercase', letterSpacing: '1.5px',
    fontWeight: 700, marginBottom: 6,
  };
  const btnPrimary = {
    padding: '11px 20px',
    background: 'linear-gradient(135deg, #00dcff 0%, #0088aa 100%)',
    color: '#050d1f',
    border: 'none',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
    boxShadow: '0 2px 12px rgba(0,220,255,0.25)',
  };
  const btnOutline = {
    padding: '9px 16px',
    background: 'transparent',
    border: `1.5px solid ${C.border}`,
    borderRadius: 9,
    fontSize: 13,
    color: C.muted,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  };
  const focusIn = (e) => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = '0 0 0 3px rgba(0,220,255,0.12)'; };
  const focusOut = (e) => { e.target.style.borderColor = 'rgba(0,220,255,0.15)'; e.target.style.boxShadow = 'none'; };

  const firstName = userName ? userName.split(' ')[0] : '';

  const navItems = [
    { key: 'dashboard', label: 'Dashboard', icon: Ico.dashboard },
    ...(role === 'passenger' ? [{ key: 'find', label: 'Find a Ride', icon: Ico.find }] : []),
    ...(role === 'driver' ? [{ key: 'offer', label: 'Offer a Ride', icon: Ico.offer }] : []),
    ...(role === 'driver' ? [{ key: 'myrides', label: 'My Rides', icon: Ico.myrides }] : []),
    { key: 'messages', label: 'Messages', icon: Ico.messages },
    { key: 'notifications', label: 'Notifications', icon: Ico.bell },
    { key: 'history', label: 'History', icon: Ico.history },
    { key: 'profile', label: 'Profile', icon: Ico.profile },
  ];

  const chatableRides = role === 'driver'
    ? myRides.filter(r => ['active', 'in_progress'].includes(r.status))
    : myStatus.filter(r => r.status === 'accepted' && !['completed', 'expired'].includes(r.ride_status));

  // ── RENDER ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg, position: 'relative' }}>
      {/* Background radial glows */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: '40%', height: '40%', background: 'radial-gradient(circle, rgba(0,220,255,0.03) 0%, transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: '220px', width: '40%', height: '40%', background: 'radial-gradient(circle, rgba(124,58,237,0.03) 0%, transparent 70%)' }} />
      </div>

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside style={{
        width: 220, position: 'fixed', top: 0, left: 0, height: '100vh',
        background: C.sidebar, borderRight: `1px solid rgba(0,220,255,0.08)`,
        display: 'flex', flexDirection: 'column', zIndex: 100,
      }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, #00dcff, #0088aa)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 12px rgba(0,220,255,0.3)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#06080f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '-0.3px', fontFamily: "'Orbitron', sans-serif" }}>CampusCarGO</span>
        </div>

        <nav style={{ flex: 1, padding: '10px 10px', overflowY: 'auto' }}>
          {navItems.map(item => {
            const active = activePage === item.key;
            return (
              <button key={item.key} onClick={() => {
                setActivePage(item.key);
                if (item.key === 'notifications' && unreadCount > 0) handleMarkNotificationsRead();
              }} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', marginBottom: 2,
                background: active ? 'rgba(0,220,255,0.08)' : 'transparent',
                border: active ? `1px solid rgba(0,220,255,0.15)` : '1px solid transparent',
                borderRadius: 9,
                color: active ? C.accent : C.muted,
                fontWeight: active ? 700 : 500, fontSize: 13,
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                transition: 'all 0.15s', position: 'relative',
                boxShadow: active ? '0 0 12px rgba(0,220,255,0.1)' : 'none',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = C.text; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.muted; } }}
              >
                {item.icon}
                {item.label}
                {item.key === 'notifications' && unreadCount > 0 && (
                  <span style={{ marginLeft: 'auto', minWidth: 18, height: 18, borderRadius: 9, background: '#f97316', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unreadCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        {userName && (
          <div style={{ padding: '14px 16px', borderTop: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: getAvatarColor(userName), color: '#06080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, border: '2px solid rgba(0,220,255,0.3)' }}>{getInitials(userName)}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{userName}</div>
              <div style={{ fontSize: 11, color: C.faint, textTransform: 'capitalize' }}>{role}</div>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <div style={{ marginLeft: 220, flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>

        {/* Header */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: 'rgba(6,8,15,0.9)', backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: `1px solid rgba(0,220,255,0.08)`,
          padding: '0 40px', height: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Welcome back, <span style={{ color: C.accent }}>{firstName || '…'}</span></h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => { setActivePage('notifications'); if (unreadCount > 0) handleMarkNotificationsRead(); }}
              style={{ position: 'relative', padding: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, borderRadius: 8, transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = C.surface}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {unreadCount > 0 && <span style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: '50%', background: '#f97316', border: `2px solid ${C.bg}`, boxShadow: '0 0 6px #f97316' }} />}
            </button>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: getAvatarColor(userName), color: '#06080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, border: '2px solid rgba(0,220,255,0.3)' }}>
              {getInitials(userName)}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main style={{ padding: activePage === 'messages' ? 0 : '32px 40px', minHeight: 'calc(100vh - 64px)' }}>
          {activePage === 'dashboard' && renderDashboard()}
          {activePage === 'find' && role === 'passenger' && renderFind()}
          {activePage === 'offer' && role === 'driver' && renderOffer()}
          {activePage === 'myrides' && role === 'driver' && renderMyRides()}
          {activePage === 'messages' && renderMessages()}
          {activePage === 'notifications' && renderNotifications()}
          {activePage === 'history' && renderHistory()}
          {activePage === 'profile' && renderProfile()}
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'success' ? 'rgba(16,217,138,0.12)' : 'rgba(255,51,102,0.12)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(16,217,138,0.3)' : 'rgba(255,51,102,0.3)'}`,
          color: toast.type === 'success' ? C.successText : C.errorText,
          padding: '11px 22px', borderRadius: 12, fontSize: 13, fontWeight: 600,
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)', zIndex: 2000,
          animation: 'fadeUp 0.3s ease both', pointerEvents: 'none', maxWidth: 380, textAlign: 'center',
        }}>{toast.msg}</div>
      )}

      {/* Live Location Modal */}
      {viewingLiveUser && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, width: 440, maxWidth: '90vw', padding: 24, boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Live Location</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Tracking {viewingLiveUser.name}</div>
              </div>
              <button onClick={() => setViewingLiveUser(null)} style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ height: 280, borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              {liveLocations[viewingLiveUser.id] ? (
                <MapContainer center={[liveLocations[viewingLiveUser.id].lat, liveLocations[viewingLiveUser.id].lng]} zoom={15} style={{ height: '100%', width: '100%' }} zoomControl={false} attributionControl={false}>
                  <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                  <CircleMarker center={[liveLocations[viewingLiveUser.id].lat, liveLocations[viewingLiveUser.id].lng]} radius={8} color="#06080f" fillColor={viewingLiveUser.id === 'driver' ? '#00dcff' : '#f97316'} fillOpacity={1} weight={2} />
                </MapContainer>
              ) : (
                <div style={{ color: C.faint, fontSize: 13, textAlign: 'center' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: C.accent, margin: '0 auto 12px', animation: 'pulse 1.5s infinite' }} />
                  Waiting for GPS signal...<br/><span style={{ fontSize: 11, opacity: 0.7 }}>Ensure the user has the app open.</span>
                </div>
              )}
            </div>
            
            {liveLocations[viewingLiveUser.id] && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 12, textAlign: 'center' }}>
                Last updated: {Math.round((Date.now() - liveLocations[viewingLiveUser.id].timestamp)/1000)}s ago
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // ═══ Page Renderers ══════════════════════════════════════════════════════════

  function renderDashboard() {
    let mainContent = null;
    if (role === 'driver') {
      const activeRide = myRides.find(r => ['active', 'in_progress'].includes(r.status));
      mainContent = (
        <div style={{ maxWidth: 860 }}>
          {analytics && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 28 }}>
              {[
                { label: 'Total Rides', value: analytics.total_rides ?? 0 },
                { label: 'Passengers', value: analytics.total_passengers ?? 0 },
                { label: 'CO2 Saved', value: analytics.total_co2_saved != null ? `${Math.round(analytics.total_co2_saved)}g` : '0g' },
                { label: 'Rating', value: analytics.avg_rating != null ? Number(analytics.avg_rating).toFixed(1) : '—', stars: analytics.avg_rating },
              ].map((s, i) => (
                <div key={i} style={{ ...card, overflow: 'hidden' }}>
                  <div style={{ height: 2, background: 'linear-gradient(90deg, #00dcff, #7c3aed)', margin: '-1px -1px 0', borderRadius: '14px 14px 0 0' }} />
                  <div style={{ padding: '18px 20px' }}>
                    <div style={{ fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.text, lineHeight: 1, fontFamily: "'Orbitron', sans-serif" }}>{s.value}</div>
                    {s.stars != null && <div style={{ marginTop: 6, fontSize: 14 }}>{renderStars(s.stars)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeRide && (
            <div style={{ ...card, padding: '20px 24px', marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, marginBottom: 14 }}>Active Route</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.accent, flexShrink: 0, boxShadow: `0 0 8px ${C.accent}` }} />
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{activeRide.start_location}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: C.successText, flexShrink: 0, boxShadow: `0 0 8px ${C.successText}` }} />
                    <span style={{ fontSize: 14, color: C.muted }}>SCT Campus</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{new Date(activeRide.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{activeRide.available_seats} seats left</div>
                </div>
              </div>
              <button onClick={() => activeRide.status === 'active' ? handleStartRide(activeRide.id) : handleCompleteRide(activeRide.id)}
                style={{ ...btnPrimary, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                {activeRide.status === 'active' ? 'Start Trip' : 'Complete Trip'}
              </button>
            </div>
          )}

          <div style={card}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                Pending Requests
                {requests.length > 0 && <span style={{ background: C.accent, color: '#050d1f', borderRadius: 10, fontSize: 10, fontWeight: 800, padding: '1px 7px' }}>{requests.length}</span>}
              </div>
              <button onClick={fetchRequests} style={{ ...btnOutline, fontSize: 11, padding: '5px 12px' }}>Refresh</button>
            </div>
            <div style={{ padding: '0 24px' }}>
              {requests.length === 0 ? (
                <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, padding: '24px 0' }}>No pending requests.</div>
              ) : requests.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: i < requests.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: getAvatarColor(r.passenger_name), color: '#06080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{getInitials(r.passenger_name)}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{r.passenger_name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{r.pickup_location}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {r.score != null && (
                      <span style={{ fontSize: 12, fontWeight: 800, color: r.score >= 60 ? C.successText : r.score >= 35 ? C.warningText : C.errorText, background: r.score >= 60 ? C.successBg : r.score >= 35 ? 'rgba(251,191,36,0.08)' : C.errorBg, border: `1px solid ${r.score >= 60 ? C.successBorder : r.score >= 35 ? 'rgba(251,191,36,0.25)' : C.errorBorder}`, padding: '3px 8px', borderRadius: 20 }}>{Math.round(r.score)}%</span>
                    )}
                    <button onClick={() => handleRespond(r.id, 'accepted')} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' }}>Accept</button>
                    <button onClick={() => handleRespond(r.id, 'rejected')} style={{ background: 'none', border: 'none', color: C.errorText, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' }}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    } else {

    // Passenger dashboard
    const acceptedRide = myStatus.find(r => r.status === 'accepted' && !['completed', 'expired'].includes(r.ride_status));
    mainContent = (
      <div style={{ maxWidth: 700 }}>
        {acceptedRide && (() => {
          // ETA calculation from live driver GPS
          const driverLoc = liveLocations['driver'];
          let etaMin = null;
          if (driverLoc && acceptedRide.pickup_lat && acceptedRide.pickup_lng) {
            const R = 6371000;
            const dLat = (acceptedRide.pickup_lat - driverLoc.lat) * Math.PI / 180;
            const dLon = (acceptedRide.pickup_lng - driverLoc.lng) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 + Math.cos(driverLoc.lat*Math.PI/180)*Math.cos(acceptedRide.pickup_lat*Math.PI/180)*Math.sin(dLon/2)**2;
            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            etaMin = Math.max(1, Math.round(dist / 5.0 / 60)); // 5 m/s ~ 18 km/h urban
          }
          // Fallback: time until departure
          const depMs = new Date(acceptedRide.departure_time).getTime();
          const nowMs = Date.now();
          const timeUntilDep = Math.max(0, Math.round((depMs - nowMs) / 60000));
          const displayEta = etaMin !== null ? etaMin : timeUntilDep;

          return (
            <div style={{ ...card, overflow: 'hidden', marginBottom: 24 }}>
              {/* Live Map Section */}
              <div style={{ height: 220, position: 'relative', background: C.surface }}>
                {driverLoc ? (
                  <MapContainer center={[driverLoc.lat, driverLoc.lng]} zoom={15} style={{ height: '100%', width: '100%' }} zoomControl={false} attributionControl={false}>
                    <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                    <CircleMarker center={[driverLoc.lat, driverLoc.lng]} radius={9}
                      color="#06080f" fillColor="#00dcff" fillOpacity={1} weight={2} />
                    {acceptedRide.pickup_lat && acceptedRide.pickup_lng && (
                      <CircleMarker center={[acceptedRide.pickup_lat, acceptedRide.pickup_lng]} radius={7}
                        color="#06080f" fillColor="#10d98a" fillOpacity={1} weight={2} />
                    )}
                  </MapContainer>
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.faint, gap: 8 }}>
                    <div style={{ width: 14, height: 14, borderRadius: '50%', background: C.accent, animation: 'glow 1.5s ease-in-out infinite' }} />
                    <span style={{ fontSize: 13 }}>Waiting for driver's GPS…</span>
                  </div>
                )}
                {/* ETA Overlay */}
                <div style={{
                  position: 'absolute', top: 14, left: 14, zIndex: 400,
                  background: 'rgba(254,250,243,0.92)', backdropFilter: 'blur(8px)',
                  borderRadius: 14, padding: '10px 18px',
                  border: `1px solid ${C.border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                }}>
                  <div style={{ fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700 }}>
                    {driverLoc ? 'Driver ETA' : 'Departs in'}
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: C.accent, fontFamily: "'Orbitron', sans-serif", lineHeight: 1.1 }}>
                    {displayEta}<span style={{ fontSize: 14, fontWeight: 600, color: C.muted, marginLeft: 4 }}>min</span>
                  </div>
                </div>
                {/* Status badge overlay */}
                <div style={{
                  position: 'absolute', top: 14, right: 14, zIndex: 400,
                  background: 'rgba(26,102,68,0.12)', border: '1px solid rgba(26,102,68,0.3)',
                  borderRadius: 20, padding: '5px 14px', fontSize: 11, fontWeight: 700,
                  color: C.successText, textTransform: 'uppercase', letterSpacing: '1px',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.successText, animation: 'glow 2s ease-in-out infinite' }} />
                  Confirmed
                </div>
              </div>

              {/* Driver Info + Actions */}
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: getAvatarColor(acceptedRide.driver_name), color: '#06080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, border: `3px solid ${C.border}`, flexShrink: 0 }}>
                    {getInitials(acceptedRide.driver_name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{acceptedRide.driver_name}</div>
                    {acceptedRide.driver_avg_rating && (
                      <div style={{ marginTop: 2, fontSize: 13 }}>
                        {renderStars(acceptedRide.driver_avg_rating)}
                        <span style={{ fontSize: 12, color: C.faint, marginLeft: 6 }}>{Number(acceptedRide.driver_avg_rating).toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.text, fontFamily: "'Orbitron', sans-serif" }}>
                      {new Date(acceptedRide.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: 12, color: C.successText, marginTop: 2 }}>{relativeTime(acceptedRide.departure_time)}</div>
                  </div>
                </div>

                {/* Route Info */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
                  <div style={{ background: C.surface, borderRadius: 10, padding: '12px 14px', border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, color: C.faint, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 3 }}>Pickup</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{acceptedRide.pickup_location}</div>
                  </div>
                  <div style={{ background: C.surface, borderRadius: 10, padding: '12px 14px', border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, color: C.faint, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 3 }}>Drop-off</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>SCT Campus</div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <button onClick={() => { setChatRideId(acceptedRide.ride_id); setActivePage('messages'); }}
                    style={{ ...btnPrimary, background: 'linear-gradient(135deg, #10d98a, #0aaa66)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    Chat
                  </button>
                  <button onClick={() => setViewingLiveUser({ id: 'driver', name: acceptedRide.driver_name })}
                    style={{ ...btnOutline, borderColor: C.accent, color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    Track
                  </button>
                  <button onClick={() => handleCancelRequest(acceptedRide.id)}
                    style={{ ...btnOutline, color: C.errorText, borderColor: C.errorBorder, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {myStatus.length > 0 && (
          <div style={card}>
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.borderLight}`, fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700 }}>My Requests</div>
            <div style={{ padding: '0 24px' }}>
              {myStatus.filter(r => !(r.status === 'accepted' && !['completed', 'expired'].includes(r.ride_status))).map((r, i, arr) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: i < arr.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{r.driver_name}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>From: {r.start_location}</div>
                    <div style={{ fontSize: 12, color: C.faint }}>{new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {statusBadge(r.status)}
                    {r.status === 'pending' && (
                      <button onClick={() => handleCancelRequest(r.id)} style={{ background: 'none', border: 'none', color: C.errorText, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 6px', fontFamily: 'inherit' }}>Cancel</button>
                    )}
                    {(!['accepted', 'pending'].includes(r.status) || (r.status === 'accepted' && ['completed', 'expired'].includes(r.ride_status))) && (
                      <button onClick={() => handleDeleteRequest(r.id)} style={{ background: 'none', border: 'none', color: C.errorText, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 6px', fontFamily: 'inherit', opacity: 0.8 }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 1}
                        onMouseLeave={e => e.currentTarget.style.opacity = 0.8}>Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {myStatus.length === 0 && (
          <div style={{ ...card, padding: '48px 32px', textAlign: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>No rides yet</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>Find a driver heading to SCT near you.</div>
            <button onClick={() => setActivePage('find')} style={btnPrimary}>Find a Ride</button>
          </div>
        )}
      </div>
    );
    }

    return (
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 300 }}>
          {mainContent}
        </div>
        
        <div style={{ width: 300, flexShrink: 0, position: 'sticky', top: 24 }}>
          {platformStats && (
            <div style={{ ...card, padding: '24px', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 16 }}>Eco Impact</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: C.accent, fontFamily: "'Orbitron', sans-serif" }}>{Math.round(platformStats.total_co2_saved_g || 0)}g</div>
              <div style={{ fontSize: 13, color: C.faint, textTransform: 'uppercase', marginBottom: 20 }}>CO2 Saved</div>

              <div style={{ background: 'rgba(16,217,138,0.05)', border: '1px solid rgba(16,217,138,0.2)', borderRadius: 12, padding: '16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 24 }}>🌳</div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.successText }}>Equivalent to</div>
                  <div style={{ fontSize: 12, color: C.muted }}>planting <strong>{platformStats.trees_equivalent || "0.00"}</strong> trees!</div>
                </div>
              </div>
              
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.text, fontFamily: "'Orbitron', sans-serif" }}>{Number(platformStats.total_distance_km || 0).toFixed(1)} km</div>
                <div style={{ fontSize: 13, color: C.faint, textTransform: 'uppercase' }}>Shared Distance</div>
              </div>
            </div>
          )}

          {/* Platform Stats Widget */}
          {platformStats && (
            <div style={{ ...card, padding: '24px' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
                Campus Stats
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { value: platformStats.total_users, label: 'Users', icon: '👥' },
                  { value: platformStats.completed_rides, label: 'Rides', icon: '🚗' },
                  { value: platformStats.active_rides, label: 'Active Now', icon: '🟢' },
                  { value: `${(platformStats.total_co2_saved_g / 1000).toFixed(1)}kg`, label: 'CO₂ Saved', icon: '🌍' },
                ].map((s, i) => (
                  <div key={i} style={{ background: C.surface, borderRadius: 10, padding: '12px', border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 16, marginBottom: 2 }}>{s.icon}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.text, fontFamily: "'Orbitron', sans-serif" }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {platformStats.avg_rating && (
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#fbbf24', fontSize: 14 }}>{'★'.repeat(Math.round(platformStats.avg_rating))}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{platformStats.avg_rating} avg from {platformStats.total_ratings} ratings</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderFind() {
    return (
      <div style={{ maxWidth: 700 }}>
        <div style={{ ...card, padding: '24px', marginBottom: 20 }}>
          <MapPicker label="Pickup location" onLocationSelect={setPickupLocation} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 }}>
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={departureDate} min={new Date().toISOString().split('T')[0]} onChange={e => setDepartureDate(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} onFocus={focusIn} onBlur={focusOut} />
            </div>
            <div>
              <label style={labelStyle}>Time</label>
              <input type="time" value={departureTimeStr} onChange={e => setDepartureTimeStr(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} onFocus={focusIn} onBlur={focusOut} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, marginBottom: 14 }}>
            {['07:00', '07:30', '08:00', '08:30', '09:00', '09:30'].map(t => {
              const active = departureTimeStr === t;
              return (
                <button key={t} onClick={() => setDepartureTimeStr(t)} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: `1.5px solid ${active ? C.accent : C.border}`, background: active ? C.accentDim : 'transparent', color: active ? C.accent : C.muted, fontWeight: active ? 700 : 400, fontFamily: 'inherit', transition: 'all 0.12s' }}>{t}</button>
              );
            })}
          </div>
          {message && (
            <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13, background: messageType === 'success' ? C.successBg : C.errorBg, border: `1px solid ${messageType === 'success' ? C.successBorder : C.errorBorder}`, color: messageType === 'success' ? C.successText : C.errorText }}>{message}</div>
          )}
          <button onClick={handleFindRides} disabled={loading} style={{ ...btnPrimary, width: '100%', opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {matches.length > 0 && (
          <div style={{ ...card, padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Filters</span>
                {activeFilterCount > 0 && <span style={{ background: C.accent, color: '#050d1f', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 10 }}>{activeFilterCount}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: C.faint }}>Showing {filteredMatches.length} of {matches.length}</span>
                {activeFilterCount > 0 && <button onClick={() => setFilters({ maxDist: 5000, timeWindow: null, minScore: 0, minRating: 0 })} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>}
                <button onClick={() => { setMatches([]); setFilters({ maxDist: 5000, timeWindow: null, minScore: 0, minRating: 0 }); setMessage(''); }} style={{ background: 'none', border: 'none', color: C.errorText, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕ Clear</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ ...labelStyle, marginBottom: 4 }}>Distance: {filters.maxDist >= 5000 ? 'Any' : `${filters.maxDist}m`}</label>
                <input type="range" min="500" max="5000" step="500" value={filters.maxDist} onChange={e => setFilters(f => ({ ...f, maxDist: Number(e.target.value) }))} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ ...labelStyle, marginBottom: 4 }}>Min score: {filters.minScore > 0 ? `${filters.minScore}%` : 'Any'}</label>
                <input type="range" min="0" max="100" step="10" value={filters.minScore} onChange={e => setFilters(f => ({ ...f, minScore: Number(e.target.value) }))} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={labelStyle}>Departure window</label>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {[null, 30, 60, 90].map(w => { const a = filters.timeWindow === w; return <button key={String(w)} onClick={() => setFilters(f => ({ ...f, timeWindow: w }))} style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: `1.5px solid ${a ? C.accent : C.border}`, background: a ? C.accentDim : 'transparent', color: a ? C.accent : C.muted, fontFamily: 'inherit', fontWeight: a ? 700 : 400 }}>{w === null ? 'Any' : `±${w}m`}</button>; })}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Min driver rating</label>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {[0, 1, 2, 3, 4, 5].map(r => { const a = filters.minRating === r; return <button key={r} onClick={() => setFilters(f => ({ ...f, minRating: r }))} style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: `1.5px solid ${a ? C.accent : C.border}`, background: a ? C.accentDim : 'transparent', color: a ? C.accent : C.muted, fontFamily: 'inherit', fontWeight: a ? 700 : 400 }}>{r === 0 ? 'Any' : `${r}★`}</button>; })}
                </div>
              </div>
            </div>
          </div>
        )}

        {matches.length > 0 && (
          <>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 16 }}>Smart Matches</div>
            {filteredMatches.map((m, i) => {
              const score = m.compatibility_score;
              const scoreColor = score >= 60 ? C.successText : score >= 35 ? C.warningText : C.errorText;
              const scoreBarGradient = score >= 60
                ? 'linear-gradient(90deg, #10d98a, #00ff88)'
                : score >= 35
                  ? 'linear-gradient(90deg, #fbbf24, #f97316)'
                  : 'linear-gradient(90deg, #ff3366, #ff6688)';
              const fullyBooked = m.available_seats === 0;
              return (
                <div key={i}
                  style={{ ...card, padding: 20, marginBottom: 12, animation: `fadeUp 0.3s ${i * 0.05}s ease both`, transition: 'box-shadow 0.2s, border-color 0.2s', cursor: 'default' }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 32px rgba(0,220,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(0,220,255,0.25)'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4)'; e.currentTarget.style.borderColor = C.border; }}
                >
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, background: getAvatarColor(m.driver_name), color: '#06080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>{getInitials(m.driver_name)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                            {m.driver_name}
                            {m.driver_avg_rating && <span style={{ fontSize: 12, color: C.warningText, fontWeight: 500, marginLeft: 8 }}>★ {Number(m.driver_avg_rating).toFixed(1)}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                            {m.start_location} → SCT Campus · {new Date(m.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {m.available_seats} seats
                          </div>
                        </div>
                        <div style={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}>
                          <svg viewBox="0 0 36 36" width="52" height="52" style={{ transform: 'rotate(-90deg)' }}>
                            <circle cx="18" cy="18" r="15.9" fill="none" stroke={C.borderLight} strokeWidth="3" />
                            <circle cx="18" cy="18" r="15.9" fill="none" stroke={scoreColor} strokeWidth="3" strokeDasharray={`${score} 100`} strokeLinecap="round"
                              style={{ filter: score >= 60 ? `drop-shadow(0 0 3px ${scoreColor})` : 'none' }} />
                          </svg>
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: scoreColor }}>{score}%</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {m.score_breakdown && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                      {[{ label: 'Detour', value: m.score_breakdown.detour }, { label: 'Time', value: m.score_breakdown.time }, { label: 'Proximity', value: m.score_breakdown.proximity }].map((b, j) => {
                        const c = b.value >= 60 ? C.successText : b.value >= 35 ? C.warningText : C.errorText;
                        const barGrad = b.value >= 60 ? 'linear-gradient(90deg, #10d98a, #00ff88)' : b.value >= 35 ? 'linear-gradient(90deg, #fbbf24, #f97316)' : 'linear-gradient(90deg, #ff3366, #ff6688)';
                        return (
                          <div key={j}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.faint, marginBottom: 4 }}><span>{b.label}</span><span style={{ color: c, fontWeight: 700 }}>{b.value}%</span></div>
                            <div style={{ height: 3, background: C.borderLight, borderRadius: 2 }}><div style={{ width: `${b.value}%`, height: '100%', background: barGrad, borderRadius: 2, transition: 'width 0.6s ease' }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <button onClick={() => handleToggleMap(m.ride_id)} style={{ width: '100%', padding: 8, marginBottom: 10, background: expandedMatchId === m.ride_id ? C.accentDim : C.surface, color: expandedMatchId === m.ride_id ? C.accent : C.muted, border: `1px solid ${expandedMatchId === m.ride_id ? 'rgba(0,220,255,0.3)' : C.border}`, borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                    {expandedMatchId === m.ride_id ? '▲ Hide map' : '▼ Show map'}
                  </button>

                  {expandedMatchId === m.ride_id && (
                    polylines[m.ride_id] === undefined ? (
                      <div style={{ height: 200, background: C.surface, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 13, marginBottom: 12 }}>Loading map…</div>
                    ) : polylines[m.ride_id] && polylines[m.ride_id].length > 0 ? (
                      <RoutePreviewMap coordinates={polylines[m.ride_id]} pickupLat={pickupLocation?.lat} pickupLng={pickupLocation?.lng} />
                    ) : (
                      <div style={{ height: 200, background: C.surface, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 13, marginBottom: 12 }}>Route preview not available</div>
                    )
                  )}

                  {fullyBooked && <div style={{ fontSize: 12, color: C.errorText, fontWeight: 600, marginBottom: 8 }}>Fully Booked</div>}
                  <button onClick={() => !fullyBooked && handleRequestRide(m)} disabled={fullyBooked} style={{ ...btnPrimary, width: '100%', opacity: fullyBooked ? 0.5 : 1, cursor: fullyBooked ? 'not-allowed' : 'pointer' }}>Request</button>
                </div>
              );
            })}
          </>
        )}

        {matches.length === 0 && !message && (
          <div style={{ ...card, padding: '48px 32px', textAlign: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <div style={{ fontSize: 14, color: C.muted }}>Enter your pickup location and search for available rides.</div>
          </div>
        )}
      </div>
    );
  }

  function renderOffer() {
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
          <div style={{ ...card, padding: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 20 }}>Create a Ride</div>
            <MapPicker label="Start Location" onLocationSelect={setPickupLocation} />
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>End Location</label>
              <div style={{ padding: '11px 14px', background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 14, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill={C.faint}><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
                SCT Campus
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Date</label>
                <input type="date" value={departureDate} min={new Date().toISOString().split('T')[0]} onChange={e => setDepartureDate(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} onFocus={focusIn} onBlur={focusOut} />
              </div>
              <div>
                <label style={labelStyle}>Time</label>
                <input type="time" value={departureTimeStr} onChange={e => setDepartureTimeStr(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} onFocus={focusIn} onBlur={focusOut} />
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Available Seats</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <button onClick={() => setSeats(s => Math.max(1, s - 1))} style={{ width: 32, height: 32, borderRadius: '50%', border: `1.5px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}>−</button>
                <span style={{ fontSize: 22, fontWeight: 800, color: C.text, minWidth: 24, textAlign: 'center', fontFamily: "'Orbitron', sans-serif" }}>{seats}</span>
                <button onClick={() => setSeats(s => Math.min(8, s + 1))} style={{ width: 32, height: 32, borderRadius: '50%', border: `1.5px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}>+</button>
              </div>
            </div>
            {message && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13, background: messageType === 'success' ? C.successBg : C.errorBg, border: `1px solid ${messageType === 'success' ? C.successBorder : C.errorBorder}`, color: messageType === 'success' ? C.successText : C.errorText }}>{message}</div>}
            <button onClick={handlePostRide} disabled={loading} style={{ ...btnPrimary, width: '100%', opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Creating…' : 'Create Ride'}
            </button>
          </div>

          <div style={{ ...card, padding: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 16 }}>Route Preview</div>
            {pickupLocation ? (
              <div style={{ borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                <MapContainer
                  key={`offer-${pickupLocation.lat}-${pickupLocation.lng}`}
                  center={[pickupLocation.lat, pickupLocation.lng]}
                  zoom={12}
                  style={{ height: '280px', width: '100%' }}
                  scrollWheelZoom={false}
                  attributionControl={false}
                  zoomControl={false}
                >
                  <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                  <FitBounds latLngs={[[pickupLocation.lat, pickupLocation.lng], [8.4682, 76.9829]]} />
                  <CircleMarker center={[pickupLocation.lat, pickupLocation.lng]} radius={9}
                    color="#06080f" fillColor={C.accent} fillOpacity={1} weight={2} />
                  <CircleMarker center={[8.4682, 76.9829]} radius={9}
                    color="#06080f" fillColor={C.successText} fillOpacity={1} weight={2} />
                </MapContainer>
              </div>
            ) : (
              <div style={{ height: 280, background: C.surface, borderRadius: 12, border: `1px dashed ${C.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.faint, gap: 12 }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16,3 21,3 21,8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21,16 21,21 16,21"/><line x1="15" y1="15" x2="21" y2="21"/>
                </svg>
                <span style={{ fontSize: 13 }}>Select a start location to preview route</span>
              </div>
            )}
          </div>
        </div>

        <div style={card}>
          <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.borderLight}`, fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px' }}>Scheduled Rides</div>
          {myRides.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: C.faint, fontSize: 13 }}>No rides scheduled yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Route', 'Time', 'Seats', 'Status', ''].map(h => <th key={h} style={{ textAlign: 'left', fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, padding: '12px 24px 10px', borderBottom: `1px solid ${C.border}`, background: 'rgba(0,220,255,0.04)' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {myRides.map((r, i) => (
                  <tr key={i} style={{ borderBottom: i < myRides.length - 1 ? `1px solid ${C.borderLight}` : 'none', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,220,255,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '12px 24px', fontSize: 14, fontWeight: 600, color: C.text }}>{r.start_location} → SCT</td>
                    <td style={{ padding: '12px 24px', fontSize: 13, color: C.muted }}>{new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td style={{ padding: '12px 24px', fontSize: 13, color: C.muted }}>{r.available_seats}</td>
                    <td style={{ padding: '12px 24px' }}><span style={{ display: 'flex', alignItems: 'center', fontSize: 13, color: { active: C.successText, in_progress: C.infoText, completed: C.muted, expired: C.faint }[r.status] || C.muted }}>{statusDot(r.status)}{r.status?.replace('_', ' ')}</span></td>
                    <td style={{ padding: '12px 24px', textAlign: 'right' }}><button onClick={() => handleDeleteRide(r.id)} style={{ background: 'none', border: 'none', color: C.errorText, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  function renderMyRides() {
    return (
      <div style={{ maxWidth: 700 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>My Rides</div>
          <button onClick={fetchMyRides} style={{ ...btnOutline, fontSize: 12, padding: '6px 14px' }}>Refresh</button>
        </div>

        {myRides.length === 0 ? (
          <div style={{ ...card, padding: '48px 32px', textAlign: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>No rides posted yet</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>Offer a ride to get started.</div>
            <button onClick={() => setActivePage('offer')} style={btnPrimary}>Offer a Ride</button>
          </div>
        ) : (
          myRides.map((ride) => {
            const isExpanded = expandedRideId === ride.id;
            const passengers = confirmedPassengers[ride.id];
            const canViewPassengers = ['active', 'in_progress', 'completed'].includes(ride.status);
            return (
              <div key={ride.id} style={{ ...card, marginBottom: 16, overflow: 'hidden' }}>
                {/* Ride header */}
                <div style={{ padding: '18px 20px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.accent, flexShrink: 0, boxShadow: `0 0 6px ${C.accent}` }} />
                        <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{ride.start_location}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 2 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.successText, flexShrink: 0, boxShadow: `0 0 6px ${C.successText}` }} />
                        <span style={{ fontSize: 13, color: C.muted }}>SCT Campus</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{new Date(ride.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      <div style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>{new Date(ride.departure_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{ride.available_seats} seats</div>
                    </div>
                  </div>
                  <div style={{ marginBottom: 14 }}>{statusBadge(ride.status)}</div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ride.status === 'active' && (
                      <button onClick={() => handleStartRide(ride.id)} style={{ ...btnPrimary, fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                        Start Trip
                      </button>
                    )}
                    {ride.status === 'in_progress' && (
                      <button onClick={() => handleCompleteRide(ride.id)} style={{ ...btnPrimary, fontSize: 13, padding: '8px 16px', background: 'linear-gradient(135deg, #10d98a, #0aaa66)' }}>
                        Complete Trip
                      </button>
                    )}
                    {canViewPassengers && (
                      <button onClick={() => handleTogglePassengers(ride.id)} style={{ ...btnOutline, fontSize: 13, padding: '8px 16px' }}>
                        {isExpanded ? 'Hide Passengers' : 'View Passengers'}
                      </button>
                    )}
                    <button onClick={() => handleDeleteRide(ride.id)} style={{ ...btnOutline, fontSize: 13, padding: '8px 14px', color: C.errorText, borderColor: C.errorBorder, marginLeft: 'auto' }}>
                      Delete
                    </button>
                  </div>
                </div>

                {/* Expanded passenger list */}
                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${C.borderLight}`, padding: '0 20px' }}>
                    <div style={{ fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, padding: '12px 0 8px' }}>Confirmed Passengers</div>
                    {passengers == null ? (
                      <div style={{ padding: '12px 0', color: C.faint, fontSize: 13 }}>Loading…</div>
                    ) : passengers.length === 0 ? (
                      <div style={{ padding: '12px 0', color: C.faint, fontSize: 13 }}>No confirmed passengers yet.</div>
                    ) : (
                      <>
                        {passengers.map((p, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < passengers.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: C.surface, border: `1.5px solid ${C.border}`, color: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: getAvatarColor(p.passenger_name), color: '#06080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{getInitials(p.passenger_name)}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{p.passenger_name}</div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button onClick={() => { setChatRideId(ride.id); setActivePage('messages'); }} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none' }}>Chat</button>
                                  <button onClick={() => setViewingLiveUser({ id: p.passenger_id, name: p.passenger_name })} style={{ background: 'none', border: 'none', color: '#f97316', fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none' }}>Live</button>
                                </div>
                              </div>
                              <div style={{ fontSize: 11, color: C.muted }}>{p.pickup_location}</div>
                            </div>
                            {p.pickup_distance_m != null && (
                              <div style={{ fontSize: 11, color: C.faint, textAlign: 'right', flexShrink: 0 }}>
                                {p.pickup_distance_m < 1000 ? `${Math.round(p.pickup_distance_m)}m` : `${(p.pickup_distance_m / 1000).toFixed(1)}km`}
                              </div>
                            )}
                          </div>
                        ))}
                        <div style={{ fontSize: 11, color: C.faint, padding: '10px 0', borderTop: `1px solid ${C.borderLight}`, marginTop: 4 }}>
                          Est. detour: ~{(passengers.reduce((sum, p) => sum + (p.pickup_distance_m || 0), 0) * 2 / 1000).toFixed(1)} km total
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  }

  function renderMessages() {
    const leftItems = role === 'driver'
      ? chatableRides.map(r => ({ id: r.id, name: `${r.start_location} → SCT`, sub: new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }))
      : chatableRides.map(r => ({ id: r.ride_id, name: r.driver_name, sub: r.start_location }));
    const selected = leftItems.find(i => i.id === chatRideId);

    return (
      <div style={{ ...card, height: 'calc(100vh - 130px)', display: 'flex', overflow: 'hidden', margin: '24px 40px' }}>
        <div style={{ width: 280, borderRight: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 700, color: C.text }}>Messages</div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {leftItems.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.faint, fontSize: 13 }}>{role === 'driver' ? 'No active rides to chat in.' : 'No confirmed rides yet.'}</div>
            ) : leftItems.map((item) => (
              <button key={item.id} onClick={() => { setChatRideId(item.id); setChatMessages([]); }}
                style={{ width: '100%', padding: '14px 20px', textAlign: 'left', background: chatRideId === item.id ? C.accentDim : 'transparent', border: 'none', borderBottom: `1px solid ${C.borderLight}`, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.1s' }}
                onMouseEnter={e => { if (chatRideId !== item.id) e.currentTarget.style.background = C.surface; }}
                onMouseLeave={e => { if (chatRideId !== item.id) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: getAvatarColor(item.name), color: '#06080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{getInitials(item.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!chatRideId ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 14 }}>Select a conversation</div>
          ) : (
            <>
              <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                {selected && <div style={{ width: 36, height: 36, borderRadius: '50%', background: getAvatarColor(selected.name), color: '#06080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{getInitials(selected.name)}</div>}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{selected?.name || 'Chat'}</div>
                  <div style={{ fontSize: 11, color: C.successText }}>Online</div>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {chatMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: C.faint, fontSize: 13, marginTop: 32 }}>No messages yet. Say hi!</div>
                ) : chatMessages.map((msg, i) => {
                  const isMine = msg.sender_id === myUserId;
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
                      {!isMine && <div style={{ fontSize: 11, color: C.faint, marginBottom: 3, paddingLeft: 4 }}>{msg.sender_name}</div>}
                      <div style={{
                        maxWidth: '70%', padding: '9px 14px', borderRadius: 16,
                        borderBottomRightRadius: isMine ? 4 : 16, borderBottomLeftRadius: isMine ? 16 : 4,
                        background: isMine ? 'linear-gradient(135deg, rgba(0,220,255,0.2), rgba(0,220,255,0.1))' : 'rgba(255,255,255,0.04)',
                        color: C.text, fontSize: 13, lineHeight: 1.5,
                        border: isMine ? '1px solid rgba(0,220,255,0.2)' : `1px solid rgba(255,255,255,0.06)`,
                      }}>{msg.message}</div>
                      <div style={{ fontSize: 10, color: C.faint, marginTop: 3, padding: '0 4px' }}>{relativeTimeShort(msg.created_at)}</div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
              <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, flexShrink: 0 }}>
                <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()} placeholder="Type a message…"
                  style={{ flex: 1, padding: '10px 16px', border: `1.5px solid ${C.border}`, borderRadius: 24, fontSize: 13, outline: 'none', background: 'rgba(255,255,255,0.04)', color: C.text, fontFamily: 'inherit', transition: 'border-color 0.15s' }}
                  onFocus={e => e.target.style.borderColor = C.accent} onBlur={e => e.target.style.borderColor = C.border}
                />
                <button onClick={handleSendMessage} disabled={!chatInput.trim() || chatSending} style={{ width: 40, height: 40, borderRadius: '50%', background: chatInput.trim() ? 'linear-gradient(135deg, #00dcff, #0088aa)' : C.surface, border: `1.5px solid ${chatInput.trim() ? C.accent : C.border}`, color: chatInput.trim() ? '#06080f' : C.faint, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: chatInput.trim() ? 'pointer' : 'not-allowed', flexShrink: 0, transition: 'all 0.15s' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/></svg>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderNotifications() {
    const getIcon = (msg) => {
      if (msg.includes('accepted') || msg.includes('confirmed')) return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.successText} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>;
      if (msg.includes('departing') || msg.includes('minutes')) return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.infoText} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>;
      if (msg.includes('cancelled')) return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.errorText} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.warningText} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    };
    return (
      <div style={{ maxWidth: 700 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 24 }}>Notifications</div>
        {notifications.length === 0 ? (
          <div style={{ ...card, padding: '48px 32px', textAlign: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <div style={{ fontSize: 14, color: C.muted }}>No notifications yet.</div>
          </div>
        ) : (
          <div style={card}>
            {notifications.map((n, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 20px', borderBottom: i < notifications.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: C.surface, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{getIcon(n.message)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>{n.message}</div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>{relativeTimeShort(n.created_at)}</div>
                </div>
                {!n.read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.accent, flexShrink: 0, marginTop: 6, boxShadow: `0 0 6px ${C.accent}` }} />}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderHistory() {
    return (
      <div style={{ maxWidth: 900 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 24 }}>Ride History</div>
        {history.length === 0 ? (
          <div style={{ ...card, padding: '48px 32px', textAlign: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-9.98L23 10"/></svg>
            <div style={{ fontSize: 14, color: C.muted }}>No completed rides yet.</div>
          </div>
        ) : (
          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Date', 'Route', 'Role', 'Rating'].map(h => <th key={h} style={{ textAlign: 'left', fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, padding: '16px 20px 12px', borderBottom: `1px solid ${C.border}`, background: 'rgba(0,220,255,0.04)' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {history.map((h, i) => {
                  const rating = role === 'driver' ? h.avg_rating_received : (h.rating_given ?? h.rating_received);
                  const ratingFull = rating != null ? Math.round(Number(rating)) : null;
                  return (
                    <tr key={i} style={{ borderBottom: i < history.length - 1 ? `1px solid ${C.borderLight}` : 'none', transition: 'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,220,255,0.02)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '14px 20px', fontSize: 13, color: C.muted, whiteSpace: 'nowrap' }}>{new Date(h.departure_time).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td style={{ padding: '14px 20px', fontSize: 14, fontWeight: 600, color: C.text }}>{h.start_location} → SCT Campus</td>
                      <td style={{ padding: '14px 20px', fontSize: 13, color: C.muted, textTransform: 'capitalize' }}>{role}</td>
                      <td style={{ padding: '14px 20px' }}>
                        {ratingFull != null ? <span style={{ color: C.warningText, fontSize: 15, letterSpacing: '2px' }}>{'★'.repeat(ratingFull)}<span style={{ color: C.faint }}>{'★'.repeat(5 - ratingFull)}</span></span> : <span style={{ color: C.faint, fontSize: 13 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function renderProfile() {
    const avgRating = analytics?.avg_rating;
    const totalRides = analytics?.total_rides ?? 0;
    const ratingFull = avgRating != null ? Math.round(Number(avgRating)) : 0;
    const pendingVisible = pendingRatings.filter(r => !dismissedRatings.has(`${r.ride_id}-${r.ratee_id}`));

    return (
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <div style={{ ...card, padding: '40px 32px', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', margin: '0 auto 16px', background: getAvatarColor(userName), color: '#06080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, border: '3px solid rgba(0,220,255,0.3)', boxShadow: '0 0 20px rgba(0,220,255,0.2)' }}>{getInitials(userName)}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 4 }}>{userName}</div>
          <div style={{ fontSize: 14, color: C.muted, marginBottom: 8 }}>{userRegNumber}</div>
          {avgRating != null && (
            <div style={{ fontSize: 16, marginBottom: 8 }}>
              <span style={{ color: C.warningText }}>{'★'.repeat(ratingFull)}</span><span style={{ color: C.faint }}>{'★'.repeat(5 - ratingFull)}</span>
              <span style={{ color: C.muted, fontSize: 14, marginLeft: 6 }}>{Number(avgRating).toFixed(1)}</span>
            </div>
          )}
          <span style={{ background: C.accentDim, color: C.accent, border: `1px solid rgba(0,220,255,0.3)`, padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>{role}</span>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 28, marginBottom: 28 }}>
            <div>
              <div style={{ fontSize: 30, fontWeight: 800, color: C.text, fontFamily: "'Orbitron', sans-serif" }}>{totalRides}</div>
              <div style={{ fontSize: 12, color: C.muted }}>Total Rides</div>
            </div>
            <div>
              <div style={{ fontSize: 30, fontWeight: 800, color: C.text, fontFamily: "'Orbitron', sans-serif" }}>{avgRating != null ? Number(avgRating).toFixed(1) : '—'}</div>
              <div style={{ fontSize: 12, color: C.muted }}>Avg Rating</div>
            </div>
          </div>

          <button onClick={onLogout} style={{ ...btnOutline, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 28px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign Out
          </button>
        </div>

        {pendingVisible.length > 0 && (
          <div style={card}>
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.borderLight}`, fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700 }}>Pending Ratings</div>
            <div style={{ padding: '0 24px' }}>
              {pendingVisible.map((pr, i) => (
                <div key={i} style={{ padding: '18px 0', borderBottom: i < pendingVisible.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Rate {pr.ratee_name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>Ride from {pr.start_location}</div>
                    </div>
                    <button onClick={() => setDismissedRatings(prev => new Set([...prev, `${pr.ride_id}-${pr.ratee_id}`]))} style={{ background: 'none', border: 'none', color: C.faint, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}>×</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <button key={star} onClick={() => setRatingStars(star)} onMouseEnter={() => setRatingHover(star)} onMouseLeave={() => setRatingHover(0)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 30, padding: '0 2px', color: star <= (ratingHover || ratingStars) ? C.warningText : C.faint, transition: 'color 0.1s, transform 0.1s', transform: star <= (ratingHover || ratingStars) ? 'scale(1.15)' : 'scale(1)' }}>★</button>
                    ))}
                  </div>
                  <button onClick={() => ratingStars > 0 && handleRate(pr.ride_id, pr.ratee_id, ratingStars)} disabled={ratingStars === 0}
                    style={{ ...btnPrimary, padding: '9px 20px', opacity: ratingStars === 0 ? 0.5 : 1, cursor: ratingStars === 0 ? 'not-allowed' : 'pointer' }}>
                    Submit Rating
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
}
