# CampusCarGO

A campus ride-sharing web app for students at **SCT College of Engineering, Pappanamcode, Thiruvananthapuram**. Drivers post rides from their home area to SCT; passengers find and request seats. All rides have a fixed destination: **SCT Pappanamcode (lat: 8.5241, lng: 76.9366)**.

---

## Architecture

| Layer | Tech |
|---|---|
| Backend | Node.js + Express 5 (port 5000) — `backend/` |
| Frontend | React 19 + Create React App (port 3000) — `frontend/` |
| Database | PostgreSQL with PostGIS extension (`campuscargo` DB) |
| Maps | Leaflet + react-leaflet; routes via OpenRouteService (ORS); geocoding via Nominatim |

---

## Running Locally

```bash
# Backend
cd backend && node server.js

# Frontend
cd frontend && npm start
```

Backend must be running before the frontend. Frontend is hardcoded to `http://localhost:5000`.

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

No `.env` needed for the frontend.

---

## Project Structure

```
backend/
  server.js              — Express app entry point, mounts all route files
  config/db.js           — PostgreSQL pool (pg), reads from .env
  routes/
    auth.js              — POST /api/auth/register, /api/auth/login
    rides.js             — Post/get/delete rides; request/respond to requests
    maps.js              — POST /api/maps/route (ORS), GET /api/maps/search (Nominatim)
    match.js             — POST /api/match/find (4-stage smart matching pipeline)

frontend/src/
  App.js                 — Token + role state; switches between Login and Dashboard
  components/
    Login.js             — Register / sign-in form
    Dashboard.js         — Full UI for driver and passenger
    MapPicker.js         — Leaflet map + Nominatim search; used in Dashboard
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
| status | `'active'` or `'completed'` |
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
| status | `'pending'`, `'accepted'`, or `'rejected'` |
| created_at | timestamptz |

---

## API Routes

### Auth — `/api/auth`
- `POST /register` — `{ name, reg_number, password, role }`
- `POST /login` — `{ reg_number, password }` → `{ token, role }`

### Rides — `/api/rides` *(all require auth)*
- `POST /post` — driver only; calls ORS to generate route polyline
- `GET /available` — all active rides with seats remaining
- `POST /request` — passenger only; `{ ride_id, pickup_location, dropoff_location }`
- `GET /requests` — driver only; pending requests for their rides
- `POST /respond` — driver only; `{ request_id, action: 'accepted'|'rejected' }`
- `GET /mystatus` — passenger only; their requests + status
- `GET /myrides` — driver only; all rides they've posted
- `DELETE /delete/:id` — driver only; deletes their ride

### Maps — `/api/maps`
- `POST /route` — calls ORS, returns coordinates + distance + duration
- `GET /search?q=...` — Nominatim geocoding scoped to Thiruvananthapuram

### Match — `/api/match`
- `POST /find` — smart matching pipeline (see below)

**Auth header format:** Raw JWT token string — `Authorization: <token>`. No `Bearer` prefix. The `verifyToken` middleware reads `req.headers['authorization']` directly.

---

## Matching Algorithm (`backend/routes/match.js`)

4-stage pipeline for `POST /api/match/find`:

### Stage 1 — Candidate Fetch (PostGIS, 3 km radius)
Single SQL query using `ST_DWithin` on `route_polyline::geography`. Fetches in one pass:
- `pickup_distance` — metres from pickup to nearest point on route (`ST_Distance`)
- `route_fraction` — 0.0–1.0 position of pickup along route (`ST_LineLocatePoint`)
- `closest_lng/lat` — actual point on route nearest to pickup (`ST_ClosestPoint`)
- `route_length_m` — total route length (`ST_Length`)
- `start_lng/lat`, `end_lng/lat` — route endpoints (`ST_StartPoint`, `ST_EndPoint`)

Results ordered by `pickup_distance ASC`, limited to 20. Excludes driver's own rides.

### Stage 2 — Pre-filter (direction & destination)
Rejects candidates before spending ORS calls on them:
- **Dropoff check:** Route endpoint must be within 2 km of SCT (Haversine). Rejects rides going the wrong place.
- **Direction check:** Angle between driver's bearing (start→end) and passenger's bearing (pickup→SCT) must be < 90°. Rejects rides going opposite direction.

### Stage 3 — Multi-Factor Scoring (top 10 candidates)
Capped at 10 to limit ORS API calls. Runs sequentially with 250ms sleep between ORS requests.

| Factor | Weight | Method |
|---|---|---|
| Detour Cost | 40% | ORS call: `start→pickup→end`. `score = max(0, 1 - (extra/original) * 5)`. Falls back to `pickupDist * 2` estimate if ORS fails. |
| Pickup Position | 25% | `route_fraction` from `ST_LineLocatePoint`. <0.3 = 1.0, <0.6 = 0.85, <0.8 = gradual decay, >0.8 = sharp penalty (near SCT). |
| Time Compatibility | 20% | Sigmoid: `1 / (1 + exp(0.15 * (diffMinutes - 30)))`. ~1.0 for 0–10 min, ~0.5 at 30 min, ~0.01 at 60+ min. |
| Proximity | 15% | `max(0, 1 - pickupDist / 3000)`. Linear decay 0m → 1.0, 3000m → 0.0. |

### Stage 4 — Sort & Filter
- Sorted by `compatibility_score` descending
- Results below 15% removed (poor matches)

### Response Fields per Match
```json
{
  "ride_id", "driver_name", "start_location", "end_location",
  "departure_time", "available_seats",
  "compatibility_score",          // 0–100 integer
  "confidence",                   // "high" | "medium" | "low"
  "pickup_distance_meters",
  "detour_label",                 // e.g. "On route", "Minimal detour", "+1.2 km detour"
  "detour_extra_meters",
  "position_label",               // e.g. "Early on route", "Mid route", "Near destination"
  "time_label",                   // e.g. "Same time", "12 min apart"
  "time_diff_minutes",
  "score_breakdown": {
    "detour": 0–100,
    "position": 0–100,
    "time": 0–100,
    "proximity": 0–100
  }
}
```

---

## Frontend Design System

All components use **inline styles** with a shared palette constant `C` defined at the top of each component file.

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

---

## Key Behaviours & Constraints

- **Destination is hardcoded** to SCT Pappanamcode everywhere. Do not make it configurable without discussion.
- **Token is in-memory only** (React state, not localStorage). Users are logged out on page refresh. This is intentional.
- **Auth header is a raw JWT string** — `Authorization: <token>`. No `Bearer` prefix anywhere. Do not add one.
- **No real-time updates** — driver/passenger lists use manual Refresh buttons.
- **ORS API key** is in `backend/.env` as `ORS_API_KEY`. The matching algorithm makes 1 ORS call per candidate ride (up to 10). Be mindful of rate limits — there is a 250ms sleep between calls.
- **Nominatim search** is scoped to Thiruvananthapuram automatically in `backend/routes/maps.js`.
- **MapPicker** uses a `FlyToLocation` sub-component that calls `useMap().flyTo` when a suggestion is selected. The dropdown uses `onMouseDown` (not `onClick`) to prevent blur-before-click race conditions.
- **JWT tokens** expire in 7 days.
- **No npm start script** on backend — run with `node server.js`.
- **CORS is open** (no origin restriction) — fine for local development.

---

## Skills Installed

- `frontend-design` (`.agents/skills/frontend-design`) — for UI/UX design passes
