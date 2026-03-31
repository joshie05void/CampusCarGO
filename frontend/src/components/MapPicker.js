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
  const [query, setQuery]         = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [marker, setMarker]       = useState(null);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
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
    <div style={{ marginBottom: '20px' }}>
      <label style={{
        display: 'block',
        fontSize: '11px',
        color: 'rgba(240,236,228,0.4)',
        textTransform: 'uppercase',
        letterSpacing: '1.5px',
        fontWeight: '600',
        marginBottom: '8px',
      }}>
        {label}
      </label>

      <div ref={wrapperRef} style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={handleSearch}
          onKeyDown={handleKeyDown}
          placeholder="Search a place or click on the map…"
          style={{
            width: '100%',
            padding: '11px 14px',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${open ? '#f0a030' : 'rgba(255,255,255,0.09)'}`,
            borderRadius: open ? '8px 8px 0 0' : '8px',
            fontSize: '14px',
            color: '#f0ece4',
            outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
          onFocus={e => { e.target.style.borderColor = '#f0a030'; e.target.style.boxShadow = '0 0 0 3px rgba(240,160,48,0.1)'; }}
          onBlur={e => { if (!open) { e.target.style.borderColor = 'rgba(255,255,255,0.09)'; e.target.style.boxShadow = 'none'; } }}
        />

        {open && (
          <ul style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            listStyle: 'none', padding: 0, margin: 0,
            background: '#18151f',
            border: '1px solid #f0a030',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            zIndex: 1000,
            maxHeight: '200px',
            overflowY: 'auto',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          }}>
            {suggestions.map((s, i) => (
              <li
                key={i}
                onMouseDown={() => handleSelect(s)}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(-1)}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: '#f0ece4',
                  borderBottom: i < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  background: hoveredIdx === i ? 'rgba(240,160,48,0.08)' : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                <span style={{ fontWeight: '600' }}>{s.display_name.split(',')[0]}</span>
                <span style={{ color: 'rgba(240,236,228,0.35)', marginLeft: '6px', fontSize: '12px' }}>
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
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}>
        <MapContainer center={[SCT.lat, SCT.lng]} zoom={13} style={{ height: '240px', width: '100%' }}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
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
          marginTop: '7px', fontSize: '12px', color: '#f0a030',
          display: 'flex', alignItems: 'center', gap: '5px', fontWeight: '600',
        }}>
          <span style={{ fontSize: '14px' }}>✓</span>
          <span>{query}</span>
        </div>
      )}
    </div>
  );
}
