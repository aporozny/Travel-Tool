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
- Mobile: React Native 0.75 (iOS + Android) - COMPLETE
- Web wrapper: React Native Web (next)

## Completed
- [x] Full backend API (auth, travelers, operators, bookings, safety, reviews)
- [x] Database schema (11 tables, PostGIS)
- [x] CI workflow, PM2, Postgres, Redis on boot
- [x] Mobile app - React Native 0.75
  - [x] Auth screens (Login, Register)
  - [x] Home screen (operator discovery)
  - [x] Operator detail screen (reviews, ratings, book button)
  - [x] Bookings screen (list with status badges)
  - [x] Create booking screen (date, guests, notes)
  - [x] Safety screen (SOS, location sharing, contacts list)
  - [x] Add contact screen (name, email, phone, permissions toggles)
  - [x] Profile screen (edit profile, budget/activity/style preferences as chips)
  - [x] Full navigation (4 tab bars, nested stacks)
  - [x] Redux store (auth slice)
  - [x] Axios API service (JWT + auto token refresh)
  - [x] TypeScript types for all entities

## In Progress
- [ ] Web wrapper (React Native Web)
  - Single codebase serves mobile app AND browser
  - Add react-native-web, webpack config, index.html entry point

## Up Next
- [ ] Notification service for SOS (SendGrid/Twilio)
- [ ] Admin routes (verify operators, manage tiers)
- [ ] Payment integration (Stripe)
- [ ] Operator dashboard (manage listings, view bookings)

## Mobile app location
/home/travel-tool/mobile/app/

## To run mobile locally (developer machine)
1. npm install (in mobile/app)
2. iOS: cd ios && pod install && cd .. && npm run ios
3. Android: npm run android
4. API URL in src/services/api.ts: 10.0.2.2 for Android emulator, localhost for iOS simulator

## API Base URL
http://localhost:5000/api/v1
