import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const C = {
  border:    '#fde68a',
  accent:    '#d97706',
  subtle:    '#fefce8',
  text:      '#1c1917',
  muted:     '#78716c',
  faint:     '#a8a29e',
};

function FlyToLocation({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo([position.lat, position.lng], 15, { duration: 1 });
  }, [position, map]);
  return null;
}

function ClickHandler({ onMapClick }) {
  useMapEvents({ click(e) { onMapClick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

export default function MapPicker({ label, onLocationSelect }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [marker, setMarker] = useState(null);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const debounceTimer = useRef(null);
  const wrapperRef = useRef(null);

  const SCT = { lat: 8.5241, lng: 76.9366 };

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setSuggestions([]);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = (e) => {
    const val = e.target.value;
    setQuery(val);
    setSuggestions([]);
    setHoveredIdx(-1);
    if (val.length < 3) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/maps/search?q=${encodeURIComponent(val)}`);
        const data = await res.json();
        setSuggestions(data);
      } catch (err) { console.error('Search error:', err); }
    }, 500);
  };

  const handleSelect = (place) => {
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);
    const name = place.display_name.split(',')[0];
    setMarker({ lat, lng });
    setQuery(name);
    setSuggestions([]);
    setHoveredIdx(-1);
    onLocationSelect({ lat, lng, name });
  };

  const handleMapClick = (lat, lng) => {
    const name = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    setMarker({ lat, lng });
    setSuggestions([]);
    setQuery(name);
    onLocationSelect({ lat, lng, name });
  };

  const handleKeyDown = (e) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown')        { e.preventDefault(); setHoveredIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp')     { e.preventDefault(); setHoveredIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && hoveredIdx >= 0) handleSelect(suggestions[hoveredIdx]);
    else if (e.key === 'Escape')      setSuggestions([]);
  };

  const open = suggestions.length > 0;

  return (
    <div style={{ marginBottom: '20px' }}>
      <label style={{ display: 'block', fontSize: '13px', color: C.muted, marginBottom: '6px' }}>
        {label}
      </label>

      <div ref={wrapperRef} style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={handleSearch}
          onKeyDown={handleKeyDown}
          placeholder="Search a place or click on the map..."
          style={{
            width: '100%',
            padding: '10px 12px',
            border: `1px solid ${open ? C.accent : C.border}`,
            borderRadius: open ? '6px 6px 0 0' : '6px',
            fontSize: '15px',
            outline: 'none',
            background: 'white',
            color: C.text,
            boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = C.accent}
          onBlur={e => { if (!open) e.target.style.borderColor = C.border; }}
        />

        {open && (
          <ul style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            listStyle: 'none', padding: 0, margin: 0,
            background: 'white',
            border: `1px solid ${C.accent}`, borderTop: 'none',
            borderRadius: '0 0 6px 6px',
            zIndex: 1000, maxHeight: '200px', overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}>
            {suggestions.map((s, i) => (
              <li
                key={i}
                onMouseDown={() => handleSelect(s)}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(-1)}
                style={{
                  padding: '10px 12px', cursor: 'pointer', fontSize: '13px', color: C.text,
                  borderBottom: i < suggestions.length - 1 ? `1px solid #fef3c7` : 'none',
                  background: hoveredIdx === i ? C.subtle : 'white',
                  transition: 'background 0.1s',
                }}
              >
                <span style={{ fontWeight: '500' }}>{s.display_name.split(',')[0]}</span>
                <span style={{ color: C.faint, marginLeft: '6px' }}>
                  {s.display_name.split(',').slice(1, 3).join(',')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: '8px', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
        <MapContainer center={[SCT.lat, SCT.lng]} zoom={13} style={{ height: '260px', width: '100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />
          <ClickHandler onMapClick={handleMapClick} />
          {marker && (
            <>
              <Marker position={[marker.lat, marker.lng]} />
              <FlyToLocation position={marker} />
            </>
          )}
        </MapContainer>
      </div>

      {marker && (
        <div style={{ marginTop: '6px', fontSize: '12px', color: C.accent, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '500' }}>
          <span>&#10003;</span>
          <span>{query}</span>
        </div>
      )}
    </div>
  );
}
