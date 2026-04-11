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

## Infrastructure
- nginx 1.24 installed, serving web app at port 80
- nginx proxies /api/ and /health to backend at port 5000
- Static files in /var/www/travel-tool/
- nginx config: /etc/nginx/sites-available/travel-tool
- Deploy script: /home/travel-tool/deploy.sh (git pull + build + copy + pm2 restart + nginx reload)
- Currently accessible at: http://21.0.1.58 (internal IP - need public IP from Binary Lane panel)

## When you get a domain
1. Point A record to the public IP
2. Update nginx server_name from _ to yourdomain.com
3. Install certbot: apt install certbot python3-certbot-nginx
4. Run: certbot --nginx -d yourdomain.com
5. SSL is automatic, certbot auto-renews

## Search & Cache System
- 3 new DB tables: places_cache, search_queries, listing_claims
- Google Places API key in backend/.env (never committed)
- GET /api/v1/search?q=&region=&category=&limit= - cache-first, falls back to Google
- GET /api/v1/search/places/:id - single place detail (enriches from Google in background)
- POST /api/v1/search/places/:id/claim - operator submits claim
- GET /api/v1/search/claims - operator views their claims
- PATCH /api/v1/search/claims/:id - admin approves/rejects
- Note: outbound Google API calls blocked in Claude sandbox - works on real VPS
- To test on VPS: curl "http://21.0.1.58/api/v1/search?q=diving&region=Nusa+Penida"

## Deployment (Live)
- Server: Proxmox VM on local hardware
- Internal IP: 172.16.128.83
- Tailscale IP: 100.67.86.49 (access via this)
- Web app: http://100.67.86.49
- API: http://100.67.86.49/api/v1
- Web app API URL hardcoded to http://100.67.86.49/api/v1 (update when domain acquired)
- Google Places API: needs Places API enabled in Google Cloud Console

## Status as of latest session
- All systems operational on VPS (Proxmox VM, Tailscale IP: 100.67.86.49)
- Google Places API working - 20 results for Seminyak restaurants confirmed
- Search cache working - first call hits Google, subsequent calls served from DB
- Operator dashboard working (overview, bookings, reviews, analytics)
- Notifications service wired into SOS (logs to console, ready for SendGrid/Twilio)
- Web app deployed with new bundle (dashboard screen for operators, explore for travelers)

## What still needs doing
- Tailwind CSS (restyle web app)
- Domain + SSL (when domain acquired)
- SendGrid/Twilio for real email/SMS notifications
- Wire search results into Explore screen in web app
- Operator dashboard accessible from web (operators land on dashboard tab automatically - done)

## Audit fixes applied (commit 51d8d64)

### Security
- Rate limiting: auth 10/15min, search 60/min, API 300/min
- Google API key no longer exposed in photo URLs - photo proxy at /api/v1/photos
- Logout now uses jwt.verify not jwt.decode (prevents crafted payload attacks)
- Operator PATCH now whitelists fields explicitly - cannot inject column names
- Booking GET/:id uses ID comparison not email for access control
- express.json limited to 10kb to prevent large payload attacks
- trust proxy enabled for correct IP detection behind nginx

### Data integrity
- Register wrapped in DB transaction - no orphaned users on failure
- Login uses dummy hash when user not found - prevents timing attacks
- Booking create validates dates (no past dates, end > start)
- authenticate middleware now verifies user is still active on every request
- Added optionalAuth middleware for public routes that can be personalized

### Performance
- Search cache: bulk INSERT (1 round trip vs N)
- Search cache: stale threshold 7 days not 24 hours
- New indexes: bookings(traveler_id,status), (operator_id,status), (start_date), (created_at)
- New index: users(email) WHERE is_active = true
- places_cache raw_data stripped - saves significant storage
- search_queries unique index fixed for NULL category handling

### To run migration on VPS
PGPASSWORD=traveller psql -U traveller -d traveller_dev -h localhost -f /home/travel-tool/backend/src/utils/migrations/001_audit_fixes.sql

## Member preferences schema live (migration 002)
- Old traveler_preferences table dropped and replaced with member_preferences
- 49 dimensions across 9 categories, all typed and indexed
- GIN indexes on array columns for operator matching queries
- Trigger auto-creates preference record when traveler is created
- New endpoints:
  - GET /travelers/me/preferences - full preference profile
  - PATCH /travelers/me/preferences - partial update (onboarding step by step)
  - GET /travelers/me/onboarding-status - progress tracking
- Onboarding tracking built in: onboarding_step (0-10), onboarding_completed bool

## Next: Onboarding flow
Build the multi-step onboarding experience in the web app.
9 steps matching the 9 preference categories.
Should feel like a conversation, not a form.
