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
  server.js              — Express entry point; mounts all route files
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
- `POST /post` — driver only; validates fields, calls ORS to generate route polyline
- `GET /available` — all active rides with seats remaining
- `POST /request` — passenger only; validates ride exists, has seats, no duplicate request
- `GET /requests` — driver only; pending requests for their rides
- `POST /respond` — driver only; verifies ownership, updates status, decrements seats if accepted
- `GET /mystatus` — passenger only; their requests + status
- `GET /myrides` — driver only; all rides they've posted
- `DELETE /delete/:id` — driver only; verifies ownership, deletes `ride_requests` first (FK), then ride

### Maps — `/api/maps`
- `POST /route` — calls ORS, returns coordinates + distance + duration
- `GET /search?q=...` — Nominatim geocoding scoped to Thiruvananthapuram

### Match — `/api/match`
- `POST /find` — 4-stage smart matching pipeline (see below)

**Auth header format:** Raw JWT — `Authorization: <token>`. No `Bearer` prefix anywhere.

---

## Matching Algorithm (`backend/routes/match.js`)

### Stage 1 — Candidate Fetch (all active rides, no distance filter)
No `ST_DWithin` radius. Every active ride in the DB is a candidate. Ordered by `pickup_distance ASC`, top 20 taken. The proximity score (exponential decay) penalises distance — no ride is ever hidden. Single SQL query fetches in one pass:
- `pickup_distance` — metres from pickup to nearest point on route (`ST_Distance`)
- `route_fraction` — 0.0–1.0 position of pickup along route (`ST_LineLocatePoint`)
- `closest_lng/lat` — nearest point on route to pickup (`ST_ClosestPoint`)
- `route_length_m` — total route length (`ST_Length`)
- `start_lng/lat`, `end_lng/lat` — route endpoints

### Stage 2 — Pre-filter (destination & direction)
Hard constraints applied before spending ORS calls:
- Route endpoint must be within 2 km of SCT (Haversine). Rejects rides going wrong place.
- Angle between driver bearing (start→end) and passenger bearing (pickup→SCT) must be <90°. Rejects backtracking rides.

### Stage 3 — Multi-Factor Scoring (top 10 candidates)
Sequential with 250ms sleep between ORS calls to respect rate limits.

| Factor | Weight | Method |
|---|---|---|
| Detour Cost | 40% | ORS: `start→pickup→end`. `score = max(0, 1 - (extra/original) * 5)`. Falls back to `pickupDist * 2` estimate if ORS fails. |
| Pickup Position | 25% | `route_fraction` from `ST_LineLocatePoint`. <0.3=1.0, <0.6=0.85, <0.8=gradual decay, >0.8=sharp penalty. |
| Time Compatibility | 20% | Sigmoid: `1 / (1 + exp(0.15 * (diffMin - 30)))`. ~1.0 for 0–10 min, ~0.5 at 30 min, ~0.01 at 60+ min. |
| Proximity | 15% | Exponential decay: `exp(-dist / 4330)`. Half-life 3 km. No floor — 0m=1.0, 3km=0.50, 10km=0.10, 20km=0.01. |

### Stage 4 — Sort (no score floor)
Sorted by `compatibility_score` descending. No minimum threshold — every candidate is returned.

### Response Fields per Match
```
ride_id, driver_name, start_location, end_location, departure_time, available_seats,
compatibility_score    — 0–100 integer
confidence             — "high" | "medium" | "low"
pickup_distance_meters
distance_label         — "Very close" | "1.4 km away" | "8.2 km away"
detour_label           — "On route" | "Minimal detour" | "+1.2 km detour"
detour_extra_meters
position_label         — "Early on route" | "Mid route" | "Late on route" | "Near destination"
time_label             — "Same time" | "12 min apart" | "2h+ apart"
time_diff_minutes
score_breakdown: { detour, position, time, proximity }  — each 0–100
```

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

---

## Key Behaviours & Constraints

- **Destination hardcoded** to SCT Pappanamcode. Do not make configurable.
- **Token in-memory only** (React state). Users log out on page refresh. Intentional.
- **Auth header is raw JWT** — `Authorization: <token>`. No `Bearer` prefix. Do not add one.
- **No real-time updates** — manual Refresh buttons throughout.
- **ORS rate limiting** — 250ms sleep between calls in match.js. Up to 10 ORS calls per match request.
- **Nominatim** scoped to Thiruvananthapuram in `maps.js` query string.
- **MapPicker** `FlyToLocation` sub-component calls `useMap().flyTo` on selection. Dropdown uses `onMouseDown` (not `onClick`) to prevent blur-before-click race.
- **FK constraint** — deleting a ride must delete `ride_requests` first. `rides.js` handles this.
- **Duplicate request guard** — passengers cannot request the same ride twice (unless previously rejected).
- **JWT tokens** expire in 7 days.
- **CORS open** — no origin restriction, fine for local dev.

---

## Skills Installed

- `frontend-design` (`.agents/skills/frontend-design`) — for UI/UX design passes
