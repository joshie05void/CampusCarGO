# CampusCarGO

A ride-sharing web app for SCT (Saintgits College of Technology) students. Drivers post rides; passengers request them. A smart matching algorithm ranks rides by compatibility using detour, position, time, and proximity scores.

## Architecture

- **Backend:** Node.js + Express (port 5000) — `backend/`
- **Frontend:** React 19 + Create React App (port 3000) — `frontend/`
- **Database:** PostgreSQL with PostGIS extension (`campuscargo` DB)
- **Maps:** Leaflet + react-leaflet; routes via OpenRouteService; geocoding via Nominatim

## Running Locally

**Backend:**
```bash
cd backend
node server.js
```

**Frontend:**
```bash
cd frontend
npm start
```

Backend must be running before the frontend (hardcoded to `http://localhost:5000`).

## Environment Variables

Create `backend/.env`:
```
DB_USER=postgres
DB_HOST=localhost
DB_NAME=campuscargo
DB_PASSWORD=<your password>
DB_PORT=5432
JWT_SECRET=<your secret>
PORT=5000
ORS_API_KEY=<your OpenRouteService key>
```

No `.env` needed for the frontend.

## API Routes

| Prefix | File | Description |
|--------|------|-------------|
| `/api/auth` | `backend/routes/auth.js` | Register, login (JWT) |
| `/api/rides` | `backend/routes/rides.js` | Post ride, request ride, accept/reject, delete |
| `/api/maps` | `backend/routes/maps.js` | Location search (Nominatim), route calc (ORS) |
| `/api/match` | `backend/routes/match.js` | Smart ride-matching algorithm |

All `/api/rides` and `/api/match` routes require `Authorization: Bearer <token>`.

## Database

PostgreSQL DB named `campuscargo`. Key tables: `users`, `rides`, `ride_requests`.
Rides store route geometry as PostGIS `LINESTRING` (EPSG:4326) enabling spatial queries (`ST_Distance`, `ST_LineLocatePoint`).

## Matching Algorithm (`backend/routes/match.js`)

Searches expanding radius (500m → 1000m → 1500m), scoring each ride on:
- **Detour (40%)** — extra driving relative to driver's route length
- **Position (25%)** — pickup position along driver's route (penalises >75%)
- **Time (20%)** — sigmoid centered at 30-min departure difference
- **Proximity (15%)** — distance to pickup point (capped at 400m)

## Key Notes

- Fixed destination: SCT Pappanamcode (lat 8.5241, lng 76.9366)
- JWT tokens expire in 7 days
- No backend npm start script — run with `node server.js`
- CORS is open (no origin restriction) — fine for local dev
