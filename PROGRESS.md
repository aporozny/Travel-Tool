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
- Auth: JWT (access 15m) + refresh tokens (7d)
- Mobile: React Native 0.75 (iOS + Android) - COMPLETE
- Web: React + webpack + TypeScript - COMPLETE
- GitHub PAT (workflow+repo scope) stored in remote URL

## Completed
- [x] Full backend API (auth, travelers, operators, bookings, safety, reviews)
- [x] Database schema (11 tables, PostGIS)
- [x] CI workflow (green, 16 tests passing)
- [x] Mobile app - React Native 0.75
  - Auth, Home, Operator detail, Bookings, Create booking
  - Safety (SOS, location, contacts), Add contact, Profile
  - Redux store, Axios JWT client, TypeScript types
- [x] Web app - React + webpack
  - Login/Register screen
  - Sidebar shell (Explore, Bookings, Safety, Profile tabs)
  - Explore: operator grid, search, category filter
  - Bookings: list with status badges
  - Safety: SOS button, emergency contacts list
  - Profile: edit profile, budget/activity/style preference chips
  - localStorage token management, auto token refresh

## In Progress
- [ ] Expose the API publicly (nginx reverse proxy + SSL)

## Up Next
- [ ] Nginx config + SSL (Let's Encrypt) so web app is accessible at a domain
- [ ] Notification service for SOS (SendGrid/Twilio)
- [ ] Admin routes (verify operators, manage tiers)
- [ ] Operator dashboard (manage listings, view bookings, analytics)
- [ ] Payment integration (Stripe)

## To run web locally (developer machine)
1. cd web && npm install
2. npm start → http://localhost:3000
3. Backend must be running on port 5000

## To run mobile locally (developer machine)
1. cd mobile/app && npm install
2. iOS: cd ios && pod install && cd .. && npm run ios
3. Android: npm run android

## API Base URL
http://localhost:5000/api/v1
