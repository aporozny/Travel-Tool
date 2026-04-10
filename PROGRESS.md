# Travel-Tool Build Progress

## Environment
- Server: Ubuntu 24 VPS
- Project path: /home/travel-tool
- Repo: https://github.com/APorozny/Travel-Tool
- Node: v22, npm: 10
- PostgreSQL 16 + PostGIS: localhost:5432, db=traveller_dev, user=traveller
- Redis: localhost:6379
- Process manager: PM2 (app name: travel-tool-api)
- Start server: pm2 restart travel-tool-api (or pm2 start "npx ts-node src/index.ts" --name "travel-tool-api" if daemon reset)
- View logs: pm2 logs travel-tool-api
- Note: services need manual start after sandbox reset: service postgresql start && service redis-server start

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
- [x] Safety routes: POST /safety/location, GET /safety/location/history, POST/GET /safety/contacts, DELETE /safety/contacts/:id, POST /safety/sos
- [x] Reviews routes: POST /reviews, GET /reviews/operator/:id (with stats), GET /reviews/me
- [x] CI workflow, PM2, Postgres, Redis on boot

## Backend complete
All core API routes are built and tested. The backend is feature-complete for v1.

## In Progress
- [ ] Mobile app (React Native) - iOS + Android from one codebase

## Up Next (post-mobile)
- [ ] Notification service for SOS (email/SMS via SendGrid or Twilio)
- [ ] Admin routes (verify operators, manage tiers)
- [ ] Operator analytics dashboard
- [ ] Payment integration (Stripe)

## API Base URL
http://localhost:5000/api/v1

## Routes summary
- POST/GET         /auth/register, /login, /refresh, /logout
- GET/PATCH        /travelers/me
- GET/PUT          /travelers/me/preferences
- GET              /operators?region=&category=&lat=&lng=&radius=
- GET              /operators/:id
- POST/PATCH       /operators, /operators/:id
- POST/GET         /bookings, /bookings/:id
- PATCH            /bookings/:id/status
- POST/GET         /safety/location, /safety/location/history
- POST/GET/DELETE  /safety/contacts, /safety/contacts/:id
- POST             /safety/sos
- POST             /reviews
- GET              /reviews/operator/:id
- GET              /reviews/me

## Key Files
- Entry point: backend/src/index.ts
- Routes: backend/src/routes/
- Middleware: backend/src/middleware/
- DB utils: backend/src/utils/db.ts
- Redis utils: backend/src/utils/redis.ts
- Schema: backend/src/utils/schema.sql
- Env: backend/.env (not in git)
