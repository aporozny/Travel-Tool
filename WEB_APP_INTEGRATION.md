# Web App Safety Integration - Phase 1

## Current Status

### Already Wired (10 endpoints)
- ✅ GET /safety/contacts
- ✅ GET /safety/trips
- ✅ GET /safety/verification/status
- ✅ POST /safety/sos
- ✅ POST /safety/verification/initiate
- ✅ POST /safety/trips/checkin
- ✅ POST /safety/trips/{id}/start
- ✅ POST /safety/trips/{id}/complete
- ✅ POST /safety/contacts
- ✅ DELETE /safety/contacts/{id}

### Missing Wiring (4 endpoints)
- ❌ POST /safety/location (location tracking)
- ❌ GET /safety/location/history (location history)
- ⚠️ POST /safety/trips (currently using /members/trips)
- ⚠️ POST /safety/trips/{id} - trip details view missing

## Build Order

### 1. Fix Trip Creation
- Change /members/trips → /safety/trips in SafetyScreen
- Verify trip creation works

### 2. Add Location Tracking
- Add location tracking button in UI
- POST to /safety/location with GPS coordinates
- Show success message

### 3. Add Location History View
- New tab/section for location history
- GET /safety/location/history
- Display map with location points

### 4. Test All Endpoints
- Create trip
- Start trip
- Check in
- Add contact
- Trigger SOS
- Track location
- View location history
- Complete trip
- Verify identity

### 5. Polish UI
- Error handling for all requests
- Loading states
- Success notifications

## Files to Modify

- web/src/screens/SafetyScreen.web.tsx (main safety screen)
- web/src/services/api.web.ts (already updated with correct URL)

