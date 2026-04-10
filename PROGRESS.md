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
- Mobile: React Native 0.75 (iOS + Android)
- Web wrapper: React Native Web (planned)

## Completed
- [x] Project structure and folder layout
- [x] Database schema (11 tables)
- [x] Backend entry point, middleware, utils (db.ts, redis.ts)
- [x] Auth routes: register, login, refresh, logout
- [x] Traveler routes: GET/PATCH /travelers/me, GET/PUT /travelers/me/preferences
- [x] Operator routes: GET /operators (filters: region, category, geo), GET /:id, POST, PATCH
- [x] Bookings routes: POST /bookings, GET /bookings, GET /:id, PATCH /:id/status
- [x] Safety routes: POST/GET /safety/location, contacts, DELETE contact, POST /safety/sos
- [x] Reviews routes: POST /reviews, GET /reviews/operator/:id (with stats), GET /reviews/me
- [x] CI workflow, PM2, Postgres, Redis on boot
- [x] Mobile app scaffold: React Native 0.75
  - [x] Auth screens (Login, Register)
  - [x] Home screen (operator discovery, Nusa Penida filter)
  - [x] Safety screen (SOS button, location sharing, contacts list)
  - [x] Navigation (stack + bottom tabs)
  - [x] Redux store (auth slice with login/register/logout)
  - [x] Axios API service (JWT interceptor + auto token refresh)
  - [x] TypeScript types for all entities

## In Progress
- [ ] Remaining mobile screens:
  - [ ] Bookings screen (list + create)
  - [ ] Operator detail screen
  - [ ] Profile screen (edit profile, preferences)
  - [ ] Add emergency contact screen

## Up Next
- [ ] Web wrapper (React Native Web)
- [ ] Notification service for SOS (SendGrid/Twilio)
- [ ] Admin routes (verify operators, manage tiers)
- [ ] Payment integration (Stripe)

## Mobile app location
/home/travel-tool/mobile/app/

## To run mobile locally (developer machine)
1. npm install (in mobile/app)
2. iOS: cd ios && pod install && cd .. && npm run ios
3. Android: npm run android
4. Change API URL in src/services/api.ts for iOS simulator (localhost vs 10.0.2.2)

## API Base URL
http://localhost:5000/api/v1
