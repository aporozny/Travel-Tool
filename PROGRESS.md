# Travel-Tool Build Progress

## Environment
- Server: Ubuntu 24 VPS
- Project path: /home/travel-tool
- Repo: https://github.com/APorozny/Travel-Tool
- Node: v22, npm: 10
- PostgreSQL 16 + PostGIS: localhost:5432, db=traveller_dev, user=traveller
- Redis: localhost:6379
- Process manager: PM2 (app name: travel-tool-api)
- Start server: pm2 restart travel-tool-api
- View logs: pm2 logs travel-tool-api

## Stack
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL + PostGIS
- Cache/Sessions: Redis
- Auth: JWT (access 15m) + refresh tokens (7d, stored in Redis)
- Mobile: React Native (not started)

## Completed
- [x] Project structure and folder layout
- [x] Database schema (11 tables)
- [x] Backend entry point, middleware, utils (db.ts, redis.ts)
- [x] Auth routes: register, login, refresh, logout
- [x] Traveler routes: GET/PATCH /travelers/me, GET/PUT /travelers/me/preferences
- [x] Operator routes: GET /operators (filters: region, category, geo), GET /:id, POST, PATCH
- [x] Bookings routes: POST /bookings, GET /bookings, GET /:id, PATCH /:id/status
- [x] CI workflow, PM2, Postgres, Redis on boot

## In Progress
- [ ] Safety/location tracking routes (POST /safety/location, GET /safety/location/history, POST /safety/contacts, GET /safety/contacts, POST /safety/sos)

## Up Next
- [ ] Reviews routes
- [ ] Mobile app (React Native)

## API Base URL
http://localhost:5000/api/v1

## Key Files
- Entry point: backend/src/index.ts
- Routes: backend/src/routes/
- Middleware: backend/src/middleware/
- DB utils: backend/src/utils/db.ts
- Redis utils: backend/src/utils/redis.ts
- Schema: backend/src/utils/schema.sql
- Env: backend/.env (not in git)
