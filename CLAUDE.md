# CampusCarGO

A campus ride-sharing web app for students at **SCT College of Engineering, Pappanamcode, Thiruvananthapuram**. Drivers post rides from their home area to SCT; passengers find and request seats. All rides have a fixed destination: **SCT Pappanamcode (lat: 8.5241, lng: 76.9366)**.

---

## Architecture

| Layer | Tech |
|---|---|
| Backend | Node.js + Express 5 (port 5000) — `backend/` |
| Frontend | React 19 + Create React App (port 3000) — `frontend/` |
| Database | PostgreSQL with PostGIS extension (`campuscargo` DB) |
| Maps | Leaflet + react-leaflet v5; routes via OpenRouteService (ORS); geocoding via Nominatim |

---

## Running Locally

```bash
# Backend
cd backend && node server.js

# Frontend
cd frontend && npm start
```

Backend must be running before the frontend. Frontend is hardcoded to `http://localhost:5000`. No `npm start` script on backend — use `node server.js` directly.

---

## Environment Variables

`backend/.env`:
```
DB_USER=postgres
DB_HOST=localhost
DB_NAME=campuscargo
DB_PASSWORD=<your password>
DB_PORT=5432
JWT_SECRET=<your secret>
PORT=5000
ORS_API_KEY=<your OpenRouteService API key>
```

---

## Project Structure

```
backend/
  server.js              — Express entry point; mounts all routes; runs migrations; node-cron job
  config/db.js           — PostgreSQL pool (pg), reads from .env
  db/
    migrate.js           — Run on startup: creates ratings, notifications tables; adds columns to ride_requests
  routes/
    auth.js              — POST /api/auth/register, /api/auth/login
    rides.js             — All ride endpoints (see API Routes below)
    maps.js              — POST /api/maps/route (ORS), GET /api/maps/search (Nominatim)
    match.js             — POST /api/match/find (4-stage smart matching pipeline)
    notifications.js     — GET /api/notifications, POST /api/notifications/read

frontend/src/
  App.js                 — Token + role state; switches between Login and Dashboard
  components/
    Login.js             — Register / sign-in form
    Dashboard.js         — Full UI for driver and passenger  ← NEEDS REWRITE (see Phase 5 task below)
    MapPicker.js         — Leaflet map + Nominatim search; FlyToLocation sub-component
  index.css              — Global resets, Inter font, body background (#fffbeb)
```

---

## Database Schema

### `users`
| column | type |
|---|---|
| id | serial PK |
| name | text |
| reg_number | text unique |
| password_hash | text |
| role | `'driver'` or `'passenger'` |

### `rides`
| column | type |
|---|---|
| id | serial PK |
| driver_id | FK → users.id |
| start_location | text |
| end_location | text (always "SCT Pappanamcode") |
| departure_time | timestamptz |
| available_seats | int |
| status | `'active'`, `'in_progress'`, `'completed'`, or `'expired'` |
| route_polyline | geometry(LineString, 4326) — stored via PostGIS |
| created_at | timestamptz |

### `ride_requests`
| column | type |
|---|---|
| id | serial PK |
| ride_id | FK → rides.id |
| passenger_id | FK → users.id |
| pickup_location | text |
| dropoff_location | text |
| status | `'pending'`, `'accepted'`, `'rejected'`, or `'cancelled'` |
| score | numeric(5,2) — compatibility score at request time (nullable) |
| pickup_lat | numeric(9,6) — passenger pickup latitude (nullable) |
| pickup_lng | numeric(9,6) — passenger pickup longitude (nullable) |
| created_at | timestamptz |

### `ratings` *(new — Phase 5)*
| column | type |
|---|---|
| id | serial PK |
| ride_id | FK → rides.id |
| rater_id | FK → users.id |
| ratee_id | FK → users.id |
| stars | integer CHECK (1–5) |
| created_at | timestamp |

### `notifications` *(new — Phase 5)*
| column | type |
|---|---|
| id | serial PK |
| user_id | FK → users.id |
| message | text |
| read | boolean DEFAULT false |
| created_at | timestamp |

---

## API Routes

### Auth — `/api/auth`
- `POST /register` — `{ name, reg_number, password, role }`
- `POST /login` — `{ reg_number, password }` → `{ token, role }`

### Rides — `/api/rides` *(all require auth)*
- `POST /post` — driver only; duplicate-ride check (2h window); calls ORS for polyline
- `GET /available` — all active rides with seats remaining
- `GET /history` — completed rides; role-aware response (driver vs passenger)
- `GET /analytics` — driver only; total rides, passengers, avg score, avg rating
- `GET /myrides` — driver only; all rides they've posted
- `GET /mystatus` — passenger only; their requests + status + `driver_avg_rating`
- `GET /requests` — driver only; pending requests for their rides
- `GET /pending-ratings` — both roles; list of completed rides needing a rating
- `POST /request` — passenger only; body: `{ ride_id, pickup_location, dropoff_location, pickup_lat, pickup_lng, score }`; broader duplicate block (any pending/accepted request, not just same ride); notifies driver
- `POST /respond` — driver only; accepts/rejects; notifies passenger
- `POST /start/:id` — driver only; sets ride status to `in_progress`
- `POST /complete/:id` — driver only; sets status to `completed`; notifies all passengers + driver
- `POST /cancel-request/:id` — passenger only; sets status to `cancelled`; restores seat if was accepted; notifies driver
- `POST /rate` — both roles; body: `{ ride_id, ratee_id, stars }`; ride must be completed
- `GET /confirmed-passengers/:id` — driver only; accepted passengers with `route_fraction` + `pickup_distance_m` computed via PostGIS; ordered by `route_fraction ASC`
- `DELETE /delete/:id` — driver only; deletes `ride_requests` first (FK), then ride
- `GET /:id/polyline` — both roles; returns `{ coordinates: [[lng,lat],...] }` from `ST_AsGeoJSON`

### Maps — `/api/maps`
- `POST /route` — calls ORS, returns coordinates + distance + duration
- `GET /search?q=...` — Nominatim geocoding scoped to Thiruvananthapuram

### Match — `/api/match`
- `POST /find` — 4-stage smart matching pipeline (see below); now also returns `driver_avg_rating` per match

### Notifications — `/api/notifications`
- `GET /` — returns last 20 notifications for current user + `unread_count`
- `POST /read` — marks all notifications as read

**Auth header format:** Raw JWT — `Authorization: <token>`. No `Bearer` prefix anywhere.

---

## Matching Algorithm (`backend/routes/match.js`)

### Stage 1 — Candidate Fetch (all active rides, no distance filter)
No `ST_DWithin` radius. Every active ride in the DB is a candidate. Ordered by `pickup_distance ASC`, top 20 taken. Single SQL query fetches in one pass (including `driver_avg_rating` subquery).

### Stage 2 — Pre-filter (destination & direction)
- Route endpoint must be within 2 km of SCT (Haversine).
- Angle between driver bearing and passenger bearing must be <90°.

### Stage 3 — Multi-Factor Scoring (top 10 candidates)
Sequential with 250ms sleep between ORS calls.

| Factor | Weight | Method |
|---|---|---|
| Detour Cost | 40% | ORS: `start→pickup→end`. Falls back to `pickupDist * 2` estimate. |
| Pickup Position | 25% | `route_fraction` from `ST_LineLocatePoint`. |
| Time Compatibility | 20% | Sigmoid: `1 / (1 + exp(0.15 * (diffMin - 30)))`. |
| Proximity | 15% | Exponential decay: `exp(-dist / 4330)`. |

### Stage 4 — Sort (no score floor)
Sorted by `compatibility_score` descending.

### Response Fields per Match
```
ride_id, driver_name, start_location, end_location, departure_time, available_seats,
compatibility_score    — 0–100 integer
confidence             — "high" | "medium" | "low"
driver_avg_rating      — float or null
pickup_distance_meters
distance_label, detour_label, detour_extra_meters
position_label, time_label, time_diff_minutes
score_breakdown: { detour, position, time, proximity }  — each 0–100
```

---

## server.js — Cron Job (node-cron)
Runs every 10 minutes:
1. Sets rides with `departure_time < NOW() - 2h` and `status IN ('active','in_progress')` to `'expired'`
2. Sends "departing soon" notifications to accepted passengers on rides departing within 30 minutes (guarded to avoid duplicates within 1 hour)

---

## Frontend Design System

All components use **inline styles** with a shared palette constant `C` at the top of each file.

| Token | Value | Used for |
|---|---|---|
| `bg` | `#fffbeb` | Page background |
| `card` | `#ffffff` | Card / input backgrounds |
| `subtle` | `#fefce8` | Stat boxes, destination field, chip backgrounds |
| `border` | `#fde68a` | All card & input borders |
| `borderLight` | `#fef3c7` | Dividers, progress bar tracks |
| `accent` | `#d97706` | Primary buttons, active states, focus rings |
| `accentDark` | `#b45309` | Hover states |
| `text` | `#1c1917` | Headings & body (warm dark) |
| `muted` | `#78716c` | Secondary text |
| `faint` | `#a8a29e` | Placeholder / tertiary text |
| `successText` | `#15803d` | Accepted status, high confidence |
| `errorText` | `#c0392b` | Rejected status, low confidence |

`index.css` sets `body { background: #fffbeb }` and the Inter font stack.

MapPicker.js imports `leaflet/dist/leaflet.css` and fixes default icon URLs. Dashboard.js can safely import from react-leaflet without re-importing the CSS.

---

## Key Behaviours & Constraints

- **Destination hardcoded** to SCT Pappanamcode. Do not make configurable.
- **Token persisted in localStorage** — keys `ccg_token` / `ccg_role`. Session survives page refresh. *(Override: was in-memory only)*
- **Auth header is raw JWT** — `Authorization: <token>`. No `Bearer` prefix. Do not add one.
- **Auto-refresh polling** — ride data polls every 15s; notifications poll every 30s. Manual Refresh buttons are still present. *(Override: was manual-only)*
- **ORS rate limiting** — 250ms sleep between calls in match.js. Up to 10 ORS calls per match request.
- **Nominatim** scoped to Thiruvananthapuram in `maps.js` query string.
- **MapPicker** `FlyToLocation` sub-component calls `useMap().flyTo` on selection. Dropdown uses `onMouseDown` (not `onClick`) to prevent blur-before-click race.
- **FK constraint** — deleting a ride must delete `ride_requests` first. `rides.js` handles this.
- **Duplicate request guard** — passengers cannot request ANY ride if they already have a pending/accepted request. Rejected and cancelled requests do not block.
- **JWT tokens** expire in 7 days.
- **CORS open** — no origin restriction, fine for local dev.
- **Coordinate order** — ORS uses `[longitude, latitude]`. PostGIS `ST_MakePoint(lng, lat)`. Do not mix up.
- **DB migrations** — `backend/db/migrate.js` runs on every `node server.js` startup using `IF NOT EXISTS` / `DO $$` patterns. Safe to re-run.

---

## Phase 5 — Incomplete Task: Dashboard.js Rewrite

**The only remaining task is a full rewrite of `frontend/src/components/Dashboard.js`.**

All backend work is complete. The frontend needs these features added (do NOT break existing functionality):

### New state needed
```javascript
const [notifications, setNotifications] = useState([]);
const [unreadCount, setUnreadCount] = useState(0);
const [showNotifDropdown, setShowNotifDropdown] = useState(false);
const [pendingRatings, setPendingRatings] = useState([]);
const [dismissedRatings, setDismissedRatings] = useState(new Set());
const [history, setHistory] = useState([]);
const [analytics, setAnalytics] = useState(null);
const [confirmedPassengers, setConfirmedPassengers] = useState({});
const [expandedRideId, setExpandedRideId] = useState(null);
const [polylines, setPolylines] = useState({});
const [expandedMatchId, setExpandedMatchId] = useState(null);
const [activeTab, setActiveTab] = useState('main');
const [filters, setFilters] = useState({ maxDist: 5000, timeWindow: null, minScore: 0, minRating: 0 });
```

### New API calls needed (all use raw JWT: `{ headers: { Authorization: token } }`)
- `GET /api/notifications` → `{ notifications, unread_count }`
- `POST /api/notifications/read` — mark all read
- `GET /api/rides/pending-ratings` → `{ pending_ratings: [{ ride_id, ratee_id, ratee_name, start_location }] }`
- `GET /api/rides/history` → `{ history: [...] }`
- `GET /api/rides/analytics` (driver only) → `{ analytics: { total_rides, total_passengers, avg_score, avg_rating } }`
- `GET /api/rides/confirmed-passengers/:rideId` → `{ passengers: [{ passenger_name, pickup_location, route_fraction, pickup_distance_m, ... }] }`
- `GET /api/rides/:rideId/polyline` → `{ coordinates: [[lng,lat],...] }` — lazy, fetch on card expand
- `POST /api/rides/start/:id`
- `POST /api/rides/complete/:id`
- `POST /api/rides/cancel-request/:requestId`
- `POST /api/rides/rate` — `{ ride_id, ratee_id, stars }`

### useEffect changes
```javascript
useEffect(() => {
  if (role === 'driver') { fetchRequests(); fetchMyRides(); fetchAnalytics(); }
  if (role === 'passenger') fetchMyStatus();
  fetchNotifications();
  fetchPendingRatings();
  fetchHistory();
  const interval = setInterval(fetchNotifications, 30000);
  return () => clearInterval(interval);
}, []);
```

### handleRequestRide — update to pass coords + score
```javascript
const handleRequestRide = async (match) => {
  // match has: ride_id, compatibility_score, driver_avg_rating etc.
  await axios.post('.../request', {
    ride_id: match.ride_id,
    pickup_location: pickupLocation.name,
    dropoff_location: SCT.name,
    pickup_lat: pickupLocation.lat,
    pickup_lng: pickupLocation.lng,
    score: match.compatibility_score,
  }, { headers: { Authorization: token } });
};
```

### Feature list to implement in Dashboard.js

**Feature 1 — Confirmed Ride Screen (Passenger)**
When `myStatus` has an entry with `status === 'accepted'` and `ride_status` not in `['completed','expired']`:
- Replace the simple status badge with a full confirmed ride card showing: driver name, departure time, pickup location, estimated wait time (`"in X minutes"` or `"X minutes ago"`), driver avg rating (stars)
- Cancel button → `POST /api/rides/cancel-request/:requestId` → refresh myStatus

**Feature 2 — Confirmed Passengers List (Driver)**
On each ride card in "My Posted Rides":
- Add "View passengers" toggle button
- On expand: `GET /api/rides/confirmed-passengers/:rideId`
- Show each passenger: numbered by pickup order (route_fraction), name, pickup location, pickup distance
- Show total detour estimate: sum of `pickup_distance_m * 2` for all passengers as rough estimate
- Mark as Started button → `POST /api/rides/start/:id` (only if status === 'active')
- Mark as Completed button → `POST /api/rides/complete/:id` (only if status === 'in_progress')
- After either action, call `fetchMyRides()`

**Feature 3 — Ride Status in UI**
Update `statusBadge` map and ride card displays to handle: `active`, `in_progress`, `completed`, `expired`

**Feature 4 — Rating Prompt**
On dashboard load, fetch `GET /api/rides/pending-ratings`. If any returned:
- Show a rating prompt card ABOVE all other content (before tabs)
- Shows: "Rate [ratee_name] for ride from [start_location]"
- 5 clickable star buttons
- Submit → `POST /api/rides/rate` → remove from pendingRatings state
- Dismiss button → add to `dismissedRatings` Set (session-only)
- Show one prompt at a time (first unDismissed item in array)

**Feature 5 — Ride History (Tab)**
Tab "History" (both roles). Fetch on tab click or mount. Display as list of cards:
- Driver: date, route (start → SCT), passengers carried, avg rating received, ratings given (who, stars)
- Passenger: date, driver name, route, rating given, rating received
- Empty state if no history

**Feature 6 — Notifications Badge + Dropdown (Navbar)**
In the navbar, next to the role label:
- Orange badge showing `unreadCount` (hidden if 0)
- On click: `POST /api/notifications/read` then toggle dropdown
- Dropdown lists last 20 notifications with message + relative time
- Clicking anywhere outside closes it

**Feature 7 — Duplicate prevention** — backend handles this; frontend just shows the error message from the API naturally (existing error handling already does this)

**Feature 8 — Search Filters (Passenger)**
Above ride results (only shown when `matches.length > 0`):
- Max pickup distance slider (0–5000m, default 5000m)
- Departure time window selector: Any / ±30min / ±60min / ±90min
- Min compatibility score slider (0–100, default 0)
- Min driver rating: Any / 1★ / 2★ / 3★ / 4★ / 5★
- Active filter count badge (count of non-default values)
- Reset Filters button
- All filtering is client-side: `const filteredMatches = matches.filter(m => ...)`
- Filters reset when Find Rides is clicked again (reset filters state in handleFindRides)
- `minRating` filter: only apply if `m.driver_avg_rating !== null` (don't filter out unrated drivers unless explicitly chosen)

**Feature 9 — Route Preview Map (Passenger ride cards)**
On each match card in results:
- "Show map" / "Hide map" toggle button
- On expand: `GET /api/rides/:rideId/polyline` (lazy, cache in `polylines` state)
- Render a `RoutePreviewMap` component (defined outside Dashboard function):
  ```javascript
  // Needs imports: MapContainer, TileLayer, Polyline, CircleMarker, useMap from 'react-leaflet'
  function FitBounds({ latLngs }) {
    const map = useMap();
    useEffect(() => { if (latLngs.length > 0) map.fitBounds(latLngs, { padding: [20, 20] }); }, []);
    return null;
  }
  function RoutePreviewMap({ coordinates, pickupLat, pickupLng }) {
    const latLngs = coordinates.map(c => [c[1], c[0]]); // [lng,lat] → [lat,lng]
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
  ```

**Feature 10 — Capacity Badge**
On each match card: if `m.available_seats === 0`, show "Fully Booked" badge and disable/grey the Request Ride button. (The match query already filters `available_seats > 0`, but handle defensively.)

**Feature 11 — Driver Analytics (Tab)**
Tab "Analytics" (driver only). Show stat boxes:
- Total rides given (`total_rides`)
- Total passengers carried (`total_passengers`)
- Avg compatibility score (`avg_score` — shown as `X%` or `—` if null)
- Avg rating received (`avg_rating` — shown as stars or `—` if null)

### Tab Structure
```
[Main] [History] [Analytics — driver only]
```
Tabs shown below a thin divider, before the tab content area. The form card is inside the Main tab.

### Important
- All new UI uses the existing `C` palette constant (inline styles only, no new CSS classes)
- Keep all existing functionality unchanged
- `handleRequestRide` now takes the full match object (not just `rideId`) so it can pass `pickup_lat`, `pickup_lng`, `score` to the API

---

---

## Current State — All Dashboard Features Complete ✅

All Phase 5 frontend features (Features 1–11) are fully implemented. The frontend is complete.

---

## Bug Fixes & Overrides (applied after Phase 5)

The following changes **override** the original spec constraints:

### 1. Persistent Authentication *(overrides "token in-memory only")*
- `App.js` now reads `ccg_token` and `ccg_role` from `localStorage` on startup (lazy `useState` initializers)
- `handleLogin` writes both keys; `handleLogout` removes them
- Page refresh no longer logs the user out

### 2. Auto-Refreshing Rides *(overrides "no real-time updates")*
- A second `setInterval` (15s) runs alongside the notifications poll (30s)
- Every 15s: driver refreshes `fetchRequests` + `fetchMyRides`; passenger refreshes `fetchMyStatus`; both refresh `fetchPendingRatings`
- The notifications poll remains at 30s (unchanged)

### 3. Chat Persistence
- `handleToggleChat` no longer closes the chat when the navbar 💬 button is clicked while chat is open
- Chat can only be closed via the explicit **"Close Chat"** button inside the panel header
- The `×` button was replaced with a labelled "Close Chat" button

### 4. Complete Ride & Rating Flow
- "Mark as Completed" button was already present (Feature 2, Batch 1)
- `handleCompleteRide` now `await`s `fetchPendingRatings()` and resets `ratingStars`/`ratingHover` immediately after completing — rating prompt appears for the driver without any manual refresh
- Passengers see their rating prompt within ~15s via the auto-refresh polling added above

---

## Skills Installed

- `frontend-design` (`.agents/skills/frontend-design`) — for UI/UX design passes
