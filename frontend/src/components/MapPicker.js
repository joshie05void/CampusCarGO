import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

function ClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

export default function MapPicker({ label, onLocationSelect }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [marker, setMarker] = useState(null);
  const debounceTimer = useRef(null);

  const SCT = { lat: 8.5241, lng: 76.9366 };

  const handleSearch = (e) => {
    const val = e.target.value;
    setQuery(val);
    setSuggestions([]);

    if (val.length < 3) return;

    // Cancel previous timer
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    // Wait 600ms after user stops typing before sending request
    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/maps/search?q=${encodeURIComponent(val)}`);
        const data = await res.json();
        setSuggestions(data);
      } catch (err) {
        console.error('Search error:', err);
      }
    }, 600);
  };

  const handleSelect = (place) => {
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);
    setMarker({ lat, lng });
    setQuery(place.display_name.split(',')[0]);
    setSuggestions([]);
    onLocationSelect({ lat, lng, name: place.display_name.split(',')[0] });
  };

  const handleMapClick = (lat, lng) => {
    setMarker({ lat, lng });
    setSuggestions([]);
    setQuery(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    onLocationSelect({ lat, lng, name: `${lat.toFixed(4)}, ${lng.toFixed(4)}` });
  };

  return (
    <div style={{ marginBottom: '20px' }}>
      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '6px' }}>{label}</label>
      <input
        type="text"
        value={query}
        onChange={handleSearch}
        placeholder="Search a place or click on map..."
        style={{ width: '100%', padding: '8px', marginBottom: '4px', boxSizing: 'border-box' }}
      />
      {suggestions.length > 0 && (
        <ul style={{ border: '1px solid #ccc', listStyle: 'none', padding: 0, margin: 0, background: 'white', position: 'absolute', zIndex: 1000, width: '100%' }}>
          {suggestions.map((s, i) => (
            <li key={i} onClick={() => handleSelect(s)}
              style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #eee' }}>
              {s.display_name}
            </li>
          ))}
        </ul>
      )}
      <div style={{ position: 'relative' }}>
        <MapContainer center={[SCT.lat, SCT.lng]} zoom={13} style={{ height: '300px', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ClickHandler onMapClick={handleMapClick} />
          {marker && <Marker position={[marker.lat, marker.lng]} />}
        </MapContainer>
      </div>
    </div>
  );
}