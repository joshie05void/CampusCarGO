import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl:       require('leaflet/dist/images/marker-icon.png'),
  shadowUrl:     require('leaflet/dist/images/marker-shadow.png'),
});

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
  const [query, setQuery]             = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [marker, setMarker]           = useState(null);
  const [hoveredIdx, setHoveredIdx]   = useState(-1);
  const debounceTimer = useRef(null);
  const wrapperRef    = useRef(null);

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
    const lat  = parseFloat(place.lat);
    const lng  = parseFloat(place.lon);
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
    if (e.key === 'ArrowDown')       { e.preventDefault(); setHoveredIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); setHoveredIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && hoveredIdx >= 0) handleSelect(suggestions[hoveredIdx]);
    else if (e.key === 'Escape')     setSuggestions([]);
  };

  const open = suggestions.length > 0;

  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{
        display: 'block',
        fontSize: '11px',
        color: '#9999bb',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        fontWeight: '600',
        marginBottom: '6px',
      }}>
        {label}
      </label>

      <div ref={wrapperRef} style={{ position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9999bb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={handleSearch}
            onKeyDown={handleKeyDown}
            placeholder="Search a place or click on map…"
            style={{
              width: '100%',
              padding: '10px 12px 10px 34px',
              background: '#ffffff',
              border: `1.5px solid ${open ? '#5b5bff' : '#e8e6f8'}`,
              borderRadius: open ? '9px 9px 0 0' : '9px',
              fontSize: '13px',
              color: '#1a1833',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s, box-shadow 0.15s',
              fontFamily: 'Plus Jakarta Sans, inherit',
            }}
            onFocus={e => { e.target.style.borderColor = '#5b5bff'; e.target.style.boxShadow = '0 0 0 3px rgba(91,91,255,0.1)'; }}
            onBlur={e => { if (!open) { e.target.style.borderColor = '#e8e6f8'; e.target.style.boxShadow = 'none'; } }}
          />
        </div>

        {open && (
          <ul style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            listStyle: 'none', padding: '4px 0', margin: 0,
            background: '#ffffff',
            border: '1.5px solid #5b5bff',
            borderTop: 'none',
            borderRadius: '0 0 9px 9px',
            zIndex: 1000,
            maxHeight: '200px',
            overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(91,91,255,0.12)',
          }}>
            {suggestions.map((s, i) => (
              <li
                key={i}
                onMouseDown={() => handleSelect(s)}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(-1)}
                style={{
                  padding: '9px 14px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: '#1a1833',
                  borderBottom: i < suggestions.length - 1 ? '1px solid #f0eeff' : 'none',
                  background: hoveredIdx === i ? 'rgba(91,91,255,0.05)' : 'transparent',
                  transition: 'background 0.1s',
                  fontFamily: 'Plus Jakarta Sans, inherit',
                }}
              >
                <span style={{ fontWeight: '600' }}>{s.display_name.split(',')[0]}</span>
                <span style={{ color: '#9999bb', marginLeft: '6px', fontSize: '12px' }}>
                  {s.display_name.split(',').slice(1, 3).join(',')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Map */}
      <div style={{
        marginTop: '8px',
        borderRadius: '10px',
        overflow: 'hidden',
        border: '1.5px solid #e8e6f8',
        boxShadow: '0 2px 12px rgba(91,91,255,0.06)',
      }}>
        <MapContainer center={[SCT.lat, SCT.lng]} zoom={13} style={{ height: '220px', width: '100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
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
        <div style={{
          marginTop: '6px', fontSize: '12px', color: '#5b5bff',
          display: 'flex', alignItems: 'center', gap: '5px', fontWeight: '600',
          fontFamily: 'Plus Jakarta Sans, inherit',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5b5bff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20,6 9,17 4,12"/>
          </svg>
          <span>{query}</span>
        </div>
      )}
    </div>
  );
}
