# Drift test plan D: Trips, Safety, Operator dashboard, Admin waitlist, public waitlist

Scope: web/src/screens/TripsScreen.web.tsx, WhosGoingPanel.tsx (rendered by Trips), SafetyScreen.web.tsx, DashboardScreen.web.tsx, AdminWaitlist.web.tsx, admin.html, components/TripModeToggle.web.tsx, hooks/useTripMode.web.ts, LoginScreen.web.tsx (waitlist form), AppShell.web.tsx (role nav) and backend routes trips.ts, safety.ts, dashboard.ts, waitlist.ts, voiceAgent.ts, reviews.ts, bookings.ts (plus members.ts and operators.ts parts these screens call) and services notifications, consent, geoPresence, voiceAgent.

Method: code reading on repo /home/andre/projects/drift (git HEAD 359cf49, deployed dist confirmed to contain the same queries), read-only schema checks (`\d`) on traveller_dev, one pure-computation zod check. No live API calls, no browser. "Confirmed by code" = evidence on both sides in the files/schema. "Runtime check" = needs a browser or API run to be sure.

Conventions: repo paths are relative to /home/andre/projects/drift. Line numbers are from `cat -n` of the deployed HEAD.
Test accounts used below: T1, T2 = travellers (onboarded); T3 = traveller with no contacts; OP1 = operator with an operators row and bookings; OP0 = operator without an operators row; ADM = admin; TC = a test contact that is a mailbox you own.

## 0. SAFE TEST rules (read before running anything)

I checked, by presence only (values not printed), that the production backend container has SENDGRID_API_KEY, MOBILEMESSAGE_API_USERNAME, SAFETY_REVIEWER_EMAIL, SAFETY_REVIEWER_PHONE and VOICE_WEBHOOK_SECRET set. So on production the following send real email or SMS to real people:

| Trigger | What it contacts | Code |
|---|---|---|
| POST /safety/sos (Send SOS button) | every safety_contacts row with receives_sos=true, by email (SendGrid) and SMS (Mobile Message) | safety.ts:165-231, notifications.ts:99-146 |
| POST /safety/reports with category harassment or safety_concern (severity 4) | reviewer email and reviewer SMS (urgent) | safety.ts:247-268, 637-647, notifications.ts:160-173 |
| POST /voice/call-ended with any outcome except false_alarm | caller's SOS contacts and the reviewer (email and SMS) | services/voiceAgent.ts:275-317 |
| POST /admin/waitlist/:id/approve (Approve button) | the waitlisted person's email address | waitlist.ts:219-224 |
| POST /trips/:id/rsvp | the trip owner's email | trips.ts:238-245 |
| Voice worker connect_to_reviewer tool, pageReviewerForLiveTransfer | dials and pages the reviewer phone | voiceWorker/agent.ts:213-240, services/voiceAgent.ts:206-238 |

There is no dry run for SOS: `sendEmail` supports SendGrid sandbox (`dryRun`, notifications.ts:33-38, 58) but no caller passes it, and `sendSms` has no dry run.

SAFE TEST ONLY procedure: run a local or staging backend against a copy of the schema with SENDGRID_API_KEY, MOBILEMESSAGE_API_USERNAME/PASSWORD/SENDER, SAFETY_REVIEWER_EMAIL, SAFETY_REVIEWER_PHONE unset. The code then logs and skips each channel (notifications.ts:41-44, 68-71) and you verify from the server log ("=== SOS ALERT ===", "Mobile Message credentials not set") and from the sos_responders rows (method 'failed' when nothing was sent). If a real delivery test is ever needed, use a TC mailbox you own, leave phone blank, never enter a real or third-party number, and never point it at production. Do not place a real phone call to the Safety Line; simulate it with the webhook routes only.

## 1. Screen and control inventory

Legend: "no UI" = the endpoint exists but no screen calls it.

### 1.1 Shell, routing, roles

| Control | File:line | Does what | API call |
|---|---|---|---|
| Role-based nav (traveller: Feed, Explore, Trips, Flights, Stays, Members, Messages, Bookings, Safety, Profile; operator: Dashboard, Bookings, Profile) | web/src/screens/AppShell.web.tsx:68-85 | Admin gets the traveller list (no Dashboard). Operator has no Trips or Safety. | none |
| Nav item click | AppShell.web.tsx:146-166 | sets tab state, closes drawer | none |
| Admin button (admin only) | AppShell.web.tsx:167-172 | window.open('/admin.html') in a new tab | none (nginx serves it, see D-D-5) |
| Sign out | AppShell.web.tsx:186 | dispatch logout | none |
| Hamburger, drawer backdrop (width under 768) | AppShell.web.tsx:108-125, hooks/useIsMobile.web.ts:3 | opens/closes drawer | none |
| Path gate for /admin* | web/src/App.web.tsx:11, 39 | renders AdminWaitlist for any path starting /admin, before any auth check | none |
| Default tab | AppShell.web.tsx:41 | operator lands on dashboard, everyone else on explore | none |

### 1.2 TripsScreen.web.tsx (curated trips)

| Control | File:line | Does what | API call |
|---|---|---|---|
| Page load | TripsScreen:75-90 | loads trips, shows Loading, error banner, empty state | GET /trips, reads res.data.trips[] (id,title,description,destination,startDate,endDate,capacity,status,confirmedCount,waitlistedCount,spotsRemaining,myRsvpStatus) |
| "+ New trip" (admin, curated tab) | :140-142 | opens CreateTripModal | none |
| Sub-tab "Curated trips" | :146-151 | switch tab | none |
| Sub-tab "Travelers going your way" | :152-157 | shows WhosGoingPanel | see 1.4 |
| Trip card | :174-222 | title, destination, date range, description, "N of M spots left" or "N going", Draft badge | none |
| "I'm in" / "Join waitlist" | :211-215 | RSVP; label is Join waitlist when spotsRemaining is 0; shows Joining... and is disabled while busy | POST /trips/:id/rsvp (no body), then GET /trips |
| "Cancel" (confirmed RSVP) | :198-200 | cancel RSVP, no confirm dialog | DELETE /trips/:id/rsvp, then GET /trips |
| "Cancel" (waitlisted RSVP) | :206-208 | same | same |
| "View RSVPs" (admin) | :216-220, 116-127 | opens modal and loads list | GET /trips/:id/rsvps, reads rsvps[] (id,status,name) |
| RSVP modal overlay click / Close | :235, 252 | close | none |
| CreateTripModal inputs: Title, Destination, Start date, End date, Capacity, Description | :300-322 | local state | none |
| Create modal overlay click, Cancel | :293, 326 | close, data lost | none |
| "Create trip" | :327, 270-290 | requires title, sends status 'published' | POST /trips {title, description?, destination?, startDate?, endDate?, capacity?, status:'published'} |
| Error banner | :162 | shows last error, only on curated tab | none |

No UI exists for: edit trip, delete trip, cancel trip, create draft, trip detail (GET /trips/:id, PATCH /trips/:id have no caller).

### 1.3 SafetyScreen.web.tsx

| Control | File:line | Does what | API call |
|---|---|---|---|
| Initial load | :95-107 | four GETs, each with catch that returns empty data | GET /safety/contacts, /safety/trips, /safety/verification/status, /safety/location/history?limit=10 |
| Tabs Overview, Trips (n), Location, Contacts (n), Identity | :248-272 | switch tab (state only, not persisted) | none |
| "Send SOS" | :287-289, 136-147 | window.confirm with contact count, then sends fixed message 'SOS triggered from web app'; shows green or red text | POST /safety/sos {message}, reads contacts_notified |
| Status cards Identity / Active trips / Emergency contacts | :294, 301, 308 | jump to tab | none |
| Overdue banner | :318-322 | shown if any trip safety_status is overdue | none |
| "+ Plan a trip" | :331 | opens form | none |
| Trip form: Destination, Region select (12 Bali regions), Start, End, Notes, "Share with community" checkbox | :338-350 | local state | none |
| Trip form Cancel / "Save trip" | :353-354, 159-179 | destination required (silent return if empty) | POST /safety/trips {destination, region?, start_date?, end_date?, notes?, is_public} (YYYY-MM-DD dates); reads returned row |
| "Start trip" (planned) | :391-393, 191-198 | activate | POST /safety/trips/:id/start, then GET /safety/trips |
| "Check in" (active or overdue) | :394-397, 181-189 | check in, alert on success | POST /safety/trips/checkin {tripId}, then GET /safety/trips |
| "Mark safe" (active or overdue) | :398-400, 200-208 | confirm, complete | POST /safety/trips/:id/complete, then GET /safety/trips |
| TripModeToggle (Location tab) | :416 | see 1.5 | see 1.5 |
| "Share my location now" | :423-425, 114-134 | getCurrentPosition then post, alert, reload history | POST /safety/location {latitude, longitude}, stores response as currentLocation; then GET /safety/location/history?limit=10 |
| Last shared block | :426-431 | reads currentLocation.recorded_at, latitude, longitude | none |
| History list and "View on map" link | :446-464 | external maps.google.com link, target _blank | none |
| "+ Add contact" | :473 | opens form | none |
| Contact form: Name, Relationship, Email, Phone | :480-483 | local state | none |
| Contact form Cancel / "Add contact" | :486-487, 210-233 | requires name and email or phone (alert), sends can_see_location:true, receives_sos:true | POST /safety/contacts {name, email?, phone?, relationship?, can_see_location, receives_sos} |
| Contact delete "X" | :514, 235-241 | confirm, delete, errors swallowed | DELETE /safety/contacts/:id |
| "Start verification" or "Re-submit documents" | :536-538, 149-157 | alert with verification id | POST /safety/verification/initiate, reads verificationId |

No UI exists for: edit contact, emergency numbers, report a place or operator, block list, SOS resolve, SOS location ping, SOS tracking link, Safety Line voice settings.

### 1.4 WhosGoingPanel.tsx (inside Trips, travelers tab)

| Control | File:line | Does what | API call |
|---|---|---|---|
| Load planned trips | :48-54 | list of members' public trips | GET /members/trips (optional ?region), reads member_name, destination, start_date, end_date, notes, id |
| "I'm going" / "Cancel" | :132 | toggle form | none |
| Form: Destination, Region, Start, End, Notes | :189-200 | local state | none |
| "Share trip" | :204, 90-111 | requires destination | POST /members/trips {destination, region?, start_date?, end_date?, notes?, is_public:true} |
| "Planned trips" / "Near you now" mode buttons | :139, 142 | switch mode | none |
| Load nearby | :56-63 | GET when nearMode or Trip Mode state changes | GET /members/nearby?radius_km=10, reads user_id, member_name, distance_km, destination |
| "Turn on" (Trip Mode) | :152 | enable then reload | POST /safety/location/trip-mode {enabled:true}, then GET /members/nearby |
| "Report" | :170, 69-78 | window.prompt (min 10 chars), fixed category safety_concern | POST /safety/reports {reportedTravelerId: user_id, category:'safety_concern', description} |
| "Block" | :172, 80-85 | confirm, remove from list | POST /members/:userId/block |
| "+N more" / "Show less" | :235 | expand list | none |
| "Be the first" | :245 | opens form | none |

### 1.5 Trip Mode

| Control | File:line | Does what | API call |
|---|---|---|---|
| Toggle switch (aria-pressed, aria-label "Toggle Trip Mode") | components/TripModeToggle.web.tsx:27-34 | enable or disable | via hook |
| Error line | TripModeToggle:36 | shows hook error | none |
| enable() | hooks/useTripMode.web.ts:45-64 | posts consent first, then geolocation.watchPosition, then setEnabled(true) | POST /safety/location/trip-mode {enabled:true} |
| watch callback throttle (5 min or 250 m) | useTripMode.web.ts:33-43 | posts a fix | POST /safety/location {latitude, longitude}, errors swallowed |
| disable() | useTripMode.web.ts:66-75 | clears watch, posts revoke | POST /safety/location/trip-mode {enabled:false} |
| Unmount cleanup | useTripMode.web.ts:77-81 | clearWatch only, no server call | none |

There is no consent dialog and no GET for consent state; the toggle itself is the consent.

### 1.6 DashboardScreen.web.tsx (operator)

| Control | File:line | Does what | API call |
|---|---|---|---|
| Page load | :19-32 | Promise.all of four calls; any failure leaves overview null | GET /dashboard/overview, /dashboard/bookings, /dashboard/reviews, /dashboard/analytics |
| Empty guard | :46 | if no overview shows "No operator profile found. Create your listing first." | none |
| Header badges tier / Verified / region | :52-57 | display only | none |
| 6 metric cards | :63-76 | display | none |
| Tabs Overview / Bookings (pending badge) / Reviews | :80-88 | switch | none |
| 30-day bars, rating breakdown | :92-127 | display | none |
| "Confirm" (pending) | :155 | status confirmed | PATCH /bookings/:id/status {status:'confirmed'} |
| "Decline" (pending) | :158 | status cancelled | PATCH /bookings/:id/status {status:'cancelled'} |
| "Mark completed" (confirmed) | :165 | status completed | PATCH /bookings/:id/status {status:'completed'} |
| Review cards | :182-194 | display | none |

No UI exists for: listing edit, offers, tier change, claims, replying to reviews. BookingsScreen.web.tsx:21 (operator "Bookings" nav) calls GET /bookings and renders b.business_name, which the operator branch does not return (bookings.ts:111-121).

### 1.7 Admin waitlist

| Control | File:line | Does what | API call |
|---|---|---|---|
| Page load and filter change | AdminWaitlist.web.tsx:28-39 | list plus counts | GET /admin/waitlist?status=waiting/invited/joined, reads entries[], counts{} |
| Filter tabs Waiting / Invited / Joined (with counts) | :83-89 | set filter | as above |
| "Approve" (status waiting only) | :119-124, 41-49 | approve and create invite link | POST /admin/waitlist/:id/approve, reads invite_url |
| Invite row: link text | :129-133 | invite_url from state or built from entry.invite_token | none |
| "Copy link" | :134-137, 51-55 | navigator.clipboard, shows Copied for 2 s | none |
| Error banner | :79 | never cleared after success | none |
| admin.html (static, not deployed) | web/src/screens/admin.html:83-176 | own login form, same list/approve, "Copy invite" | POST /auth/login, GET /admin/waitlist, POST /admin/waitlist/:id/approve |

No UI exists for: export, manual invite, resend or renew invite, reject, delete, search, "approved" filter, pagination.

### 1.8 Public waitlist and invite (LoginScreen.web.tsx)

| Control | File:line | Does what | API call |
|---|---|---|---|
| "Join the waitlist" link on login form | :404 | mode waitlist (Landing "Join free" goes to register, :149) | none |
| Name, Email (Enter submits), Destination (Enter submits) | :180-198 | local state | none |
| "Join the waitlist" | :201-204, 102-114 | requires email, source 'direct' | POST /waitlist {email, name?, destination?, source:'direct'} |
| Success panel and "Back to home" | :164-169 | success state | none |
| "Create your account" / "Sign in" / Back | :160, 207, 210 | mode change | none |
| /invite/:token on load | :28-52 | validates, jumps to register with email locked | GET /waitlist/invite/:token, reads valid, email, name, message |
| Register with invite | :83-100 | after register calls use-invite, errors swallowed | POST /waitlist/use-invite {token} (route does not exist) |

## 2. API contract check

| UI call | Backend route file:line | Match? | Problem |
|---|---|---|---|
| GET /trips | trips.ts:78-93 | Yes | Cancelled trips never returned (trips.ts:83); admin sees own drafts only |
| POST /trips | trips.ts:112-131, schema :16-27 | Yes | UI has no draft path; end date not checked against start; admin only (403 for others, :35-41) |
| POST /trips/:id/rsvp | trips.ts:200-255 | Yes | 409 'Already RSVPed' shown as banner on double click; non-uuid id gives 500 (:205) |
| DELETE /trips/:id/rsvp | trips.ts:261-296 | Yes | none |
| GET /trips/:id/rsvps | trips.ts:168-195 | Yes | admin only; UI reads id, status, name which are returned |
| GET /trips/:id, PATCH /trips/:id | trips.ts:96-109, 134-164 | no UI | non-uuid id gives 500 |
| GET /members/trips | members.ts:188-245 | Yes | public (optionalAuth); does not filter blocked users |
| POST /members/trips | members.ts:537-566 | Yes | creates member_trips row (safety_status planned), so it appears in Safety > Trips |
| GET /members/nearby | members.ts:255-310 | Yes | 400 unless caller has a cached location (:75-78) |
| POST /safety/reports from WhosGoingPanel:72 | safety.ts:604-658 | NO | reportedTravelerId is users.id (members.ts:88) but safety_reports.reported_traveler_id references travelers(id): FK violation, 500 |
| POST /members/:id/block | members.ts:426-441 | Yes | user_blocks has no FK; unblock route exists (:444) but no UI |
| POST /safety/location/trip-mode | safety.ts:99-112 | Yes | no role check; no GET status route |
| POST /safety/location (hook) | safety.ts:38-69 | Yes | 403 for non-traveller or no consent, swallowed by hook (useTripMode:42) |
| POST /safety/location (SafetyScreen:122) | safety.ts:63 | NO | returns {id, recorded_at} only; UI reads latitude/longitude (SafetyScreen:429), crash |
| GET /safety/location/history | safety.ts:71-92 | Yes | limit=abc gives NaN and 500 (:84); columns lat, lng, accuracy_m, created_at exist |
| GET /safety/contacts | safety.ts:135-149 | Yes | none |
| POST /safety/contacts | safety.ts:114-133 | Yes | invalid email gives 400, UI shows generic text |
| DELETE /safety/contacts/:id | safety.ts:151-163 | Yes | none |
| POST /safety/sos | safety.ts:165-231 | Yes (fields) | UI green "sent" even at 0 contacts; location only if Redis cache exists |
| GET /safety/trips | safety.ts:382-398 | Yes | UI type has region and is_public, never returned (unused in render); start_date is a DATE returned as ISO string |
| POST /safety/trips | safety.ts:359-379, schema :342-348 | NO | schema needs start_date and end_date as ISO datetime, both required; UI sends YYYY-MM-DD or undefined. Verified with the repo's zod: date-only false, missing false, ISO true. region and is_public are dropped by zod |
| POST /safety/trips/:id/start | safety.ts:401-419 | Yes | 404 message not shown (UI generic alert); UPDATE joins travelers with no condition (:407) |
| POST /safety/trips/checkin | safety.ts:422-477 | Yes | columns of trip_checkins verified |
| POST /safety/trips/:id/complete | safety.ts:478-494 | Yes | same cross join (:482) |
| GET /safety/verification/status | safety.ts:308-324 | Yes | none |
| POST /safety/verification/initiate | safety.ts:273-305 | Yes | stub: creates a pending row only |
| GET /dashboard/overview | dashboard.ts:18-52 | Yes | all selected columns exist |
| GET /dashboard/bookings | dashboard.ts:56-91 | NO | LEFT JOIN traveler_preferences (:72) but that table does not exist (\d: not found): 500 always |
| GET /dashboard/reviews | dashboard.ts:95-116 | NO | selects r.title (:99); reviews has no title column: 500 always |
| GET /dashboard/analytics | dashboard.ts:143-182 | Yes | columns exist |
| GET /dashboard/claims | dashboard.ts:120-139 | NO | lc.operator_id, lc.place_cache_id, lc.evidence, lc.reviewed_at do not exist in listing_claims (live: id, place_id, user_id, status, created_at); no UI |
| PATCH /bookings/:id/status | bookings.ts:172-232 | Yes | no notification sent (sendBookingNotification never called) |
| GET /bookings (BookingsScreen) | bookings.ts:93-131 | Partly | operator branch has no business_name |
| POST /bookings, GET /bookings/:id | bookings.ts:24-89, 134-168 | no UI | columns exist in live table |
| POST /reviews, GET /reviews/operator/:id, GET /reviews/me | reviews.ts:59-73, 92, 133 | NO | all reference reviews.title which does not exist: 500; no UI |
| GET /admin/waitlist | waitlist.ts:151-183 | Yes | none; no pagination |
| POST /admin/waitlist/:id/approve | waitlist.ts:187-236 | Yes | no guard when already invited: regenerates token |
| POST /waitlist | waitlist.ts:22-72 | Yes | any zod error returns "Invalid email address." (:66-68); columns incl. destination exist |
| GET /waitlist/invite/:token | waitlist.ts:97-130 | Yes | none |
| POST /waitlist/use-invite (LoginScreen:93) | none | NO | route missing, 404 swallowed |
| GET /waitlist/check | waitlist.ts:76-93 | no UI | public email enumeration |
| GET /safety/emergency-numbers | safety.ts:693-718 | no UI | error key is `error`, not `message` |
| POST /safety/sos/:id/ping, /resolve; GET /sos/:id/stream | safety.ts:499-588 | no UI | stream has no authenticate (:561); resolve emits event without ownership or row check (:541-553) |
| /voice/* (5 routes) | voiceAgent.ts:36, 60, 82, 100, 123 | webhook only | requires header x-webhook-secret (requireWebhookSecret.ts:11-20) |
| POST/GET/PATCH /operators/claims | operators.ts:125-235, 303-333 | NO | same missing listing_claims columns; no UI |
| PATCH /operators/:id | operators.ts:420-467 | no UI | ownership by user_id; admin cannot edit |

## 3. Test cases

Priority: P1 must run, P2 should, P3 nice. Where the expected result is the correct behaviour and current code differs, the row says "Current:" with the defect id.

### 3.1 Curated trips (Trips screen)

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-TRP-01 | Trips list | T1; 3 published trips (one with capacity 5, one unlimited, one with dates) | 1) Sign in as T1. 2) Click Trips in nav. | Cards show title, destination, formatted date range, description; capacity trips show "N of M spots left", unlimited show "N going"; no Draft badge | P1 | UI | TripsScreen:75-90, 174-192 |
| D-TRP-02 | Empty and error states | No published trips; then API blocked (local: stop backend) | 1) Open Trips with empty table. 2) Stop backend, reload, open Trips. | Empty: "No trips posted yet" and no "Create one" line for T1. Error: red banner "Could not load trips.", Loading text disappears | P2 | Edge | TripsScreen:86, 164-170 |
| D-TRP-03 | Role isolation UI | T1, ADM | 1) As T1 open Trips. 2) As ADM open Trips. | T1: no "+ New trip", no "View RSVPs". ADM: both shown | P1 | Security | TripsScreen:140, 216 |
| D-TRP-04 | RSVP happy path | T1, trip with 3 spots | 1) Click "I'm in". 2) Watch button. | Button shows "Joining..." and is disabled; after reload badge "You're going" with Cancel; spots left drops by 1; POST /trips/:id/rsvp returns 201 {status:'confirmed'} | P1 | UI | TripsScreen:92-102, trips.ts:200-255 |
| D-TRP-05 | Waitlist | Trip capacity 1 already confirmed by T2; T1 | 1) Note text "0 of 1 spots left". 2) Click "Join waitlist". | Badge "Waitlisted", text "· 1 waitlisted"; API status 'waitlisted' | P1 | UI | TripsScreen:213, trips.ts:221-228 |
| D-TRP-06 | Waitlist promotion | D-TRP-05 state | 1) T2 clicks Cancel. 2) Reload as T1. | T1 becomes "You're going" (oldest waitlisted promoted); T2 sees "I'm in" again | P1 | API | trips.ts:277-285 |
| D-TRP-07 | Cancel waitlisted and re-join | T1 waitlisted | 1) Click Cancel. 2) Click "I'm in" again. | Cancel gives 200 and button returns; re-join updates the same row (unique trip_id,user_id), no duplicate error | P2 | Edge | trips.ts:230-231, DB unique constraint |
| D-TRP-08 | Rapid double click RSVP | T1, trip open | 1) Double-click "I'm in" fast. 2) Also send two concurrent POST /trips/:id/rsvp via API. | UI: one RSVP, button disabled while busy, no error banner. API: one 201 and one 409 "Already RSVPed to this trip" | P2 | Edge | TripsScreen:212, trips.ts:216-219 |
| D-TRP-09 | RSVP invalid targets | T1 token | 1) POST /trips/<draft id>/rsvp. 2) POST /trips/<cancelled id>/rsvp. 3) POST /trips/not-a-uuid/rsvp. | 1-2: 404 "Trip not found". 3: should be 400 or 404 (Current: 500, D-D-35) | P3 | Validation | trips.ts:205-209 |
| D-TRP-10 | Refresh mid-flow | T1 | 1) Click "I'm in" and reload within 1 s. 2) Reopen Trips. | State reflects server truth (either "You're going" or not), no duplicate rows | P3 | Edge | TripsScreen:75-77 |
| D-TRP-11 | Admin create happy path | ADM | 1) Click "+ New trip". 2) Title "QA Bali", Destination "Bali, Indonesia", Start and End future dates, Capacity 5, Description. 3) Click "Create trip". | Button "Creating..."; modal closes; card appears; POST /trips 201 with id | P1 | UI | TripsScreen:270-290, trips.ts:112-131 |
| D-TRP-12 | Create validation | ADM, modal open | 1) Empty title, click Create. 2) 201-char title. 3) Capacity 0 then 1.5. 4) Description 4001 chars. | 1) "Title is required" and no request. 2) banner "Validation error". 3) 0 rejected, 1.5 becomes 1 (parseInt). 4) "Validation error" | P2 | Validation | TripsScreen:271, trips.ts:16-27 |
| D-TRP-13 | End before start | ADM | Create trip with End date earlier than Start | Should be rejected. Current: accepted (D-D-37) | P3 | Edge | TripsScreen:270-283, trips.ts:22-23 |
| D-TRP-14 | Create as non-admin (API) | T1 token | POST /trips with valid body | 403 {message:'Admin only'}; no row created | P1 | Security | trips.ts:114, 35-41 |
| D-TRP-15 | Double click Create | ADM, modal filled | Double-click "Create trip" | Disabled during save; exactly one trip created | P2 | Edge | TripsScreen:327 |
| D-TRP-16 | View RSVPs | ADM, trip with 1 confirmed, 1 waitlisted, 1 cancelled RSVP | 1) Click "View RSVPs". 2) Click overlay, reopen, click Close. | Modal lists confirmed and waitlisted only, name (display name, else first/last, else email) and status; cancelled excluded; overlay and Close both close | P1 | UI | TripsScreen:116-127, 234-255, trips.ts:168-195 |
| D-TRP-17 | RSVP list stale on error | ADM, two trips A (has RSVPs) and B | 1) Open View RSVPs on A, close. 2) Make GET /trips/B/rsvps fail (local: stop backend or use invalid token), open on B. | Must show an error or empty state, not A's list. Current: A's rows are shown (D-D-20); error banner is hidden behind the overlay | P3 | Edge | TripsScreen:116-127 |
| D-TRP-18 | RSVPs as non-admin (API) | T1 token | GET /trips/<id>/rsvps | 403 Admin only | P1 | Security | trips.ts:170 |
| D-TRP-19 | Edit, cancel, delete (API only) | ADM, T1 | 1) PATCH /trips/:id {status:'cancelled'} as ADM. 2) Same as T1. 3) PATCH with {}. 4) DELETE /trips/:id. | 1) 200 and trip vanishes from lists. 2) 403. 3) 400 "No fields to update". 4) 404 (no route: no delete exists, D-D-21) | P2 | API | trips.ts:134-164 |
| D-TRP-20 | Trip detail (API only) | T1, T2, ADM | GET /trips/:id for published, for a draft created by ADM (as T1), for the same draft as ADM | Published 200; draft as T1 404; draft as ADM 200 | P3 | API | trips.ts:96-109 |
| D-TRP-21 | Date display across time zones | Trip start 2026-10-01 | View card with browser TZ set to Australia/Sydney then America/Los_Angeles | Shows Oct 1 in both (runtime check; pg DATE serialised as ISO, TripsScreen:55) | P3 | Edge | TripsScreen:52-59 |
| D-TRP-22 | Sub-tab switching | T1, ADM | Toggle Curated and Travelers tabs repeatedly with an error banner showing | Banner and "+ New trip" only on Curated; no crash; WhosGoingPanel remounts | P3 | UI | TripsScreen:140, 160-162 |

### 3.2 Travellers going your way (member trips, nearby, report, block)

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-WHO-01 | Planned list | T2 has 5 public future trips | As T1 open Trips > Travelers | Initials, "name is heading to destination", date range (en-AU), notes; first 3 shown, "+2 more" expands and "Show less" collapses; own trips excluded | P2 | UI | WhosGoingPanel:48-54, 235; members.ts:188-245 |
| D-WHO-02 | Empty | No public trips | Open panel; click "Be the first" | "No trips shared yet." then form opens | P3 | UI | WhosGoingPanel:245 |
| D-WHO-03 | Share a trip | T1 | 1) Click "I'm going". 2) Destination "Ubud", Start and End dates, note. 3) Click "Share trip". | POST /members/trips 201; form closes and resets; trip appears; also listed as 'planned' in Safety > Trips | P1 | UI | WhosGoingPanel:90-111, members.ts:537-566 |
| D-WHO-04 | Share validation | T1 | 1) Empty destination. 2) Destination 101 chars. 3) Notes 501 chars. | 1) "Share trip" disabled. 2-3) alert "Could not save trip." (400); no row | P3 | Validation | WhosGoingPanel:204, members.ts:525-535 |
| D-WHO-05 | Near you now, Trip Mode off | T1 with no cached location | 1) Click "Near you now". 2) Click "Turn on". 3) Allow location. | 1) shows "Turn on Trip Mode to see who's nearby." 2-3) toggles on and then lists nearby members. Current: list is requested before the first location post, so the same prompt can return (D-D-16); needs runtime check | P1 | Edge | WhosGoingPanel:152, members.ts:75-78 |
| D-WHO-06 | Nearby results | T1 and T2 both Trip Mode on, T2 within 10 km, T3 more than 10 km, T4 has show_in_directory false | As T1 open "Near you now" | Only T2 listed with whole-km distance and destination if any; T1 not listed; T4 hidden | P1 | UI | members.ts:81-119 |
| D-WHO-07 | Report from nearby list (SAFE TEST ONLY) | Local backend with reviewer channels unset; T1 sees T2 | 1) Click "Report". 2) Enter 5 chars, OK. 3) Click again, Cancel prompt. 4) Click again, enter 20+ chars. | 2-3) no request. 4) 201 and alert "Report submitted..." and a safety_reports row with severity 4 and reviewer alert logged. Current: 500 FK violation, alert "Could not submit report" (D-D-6) | P1 | Safety | WhosGoingPanel:69-78, safety.ts:621-631 |
| D-WHO-08 | Block and undo | T1 sees T2 | 1) Click "Block", Cancel. 2) Click "Block", OK. 3) Reload panel. 4) DELETE /members/<T2 user id>/block via API. | 1) nothing. 2) T2 disappears. 3) still hidden and T1 is also hidden from T2. 4) T2 reappears. No UI to undo although the dialog says you can (D-D-23) | P1 | UI | WhosGoingPanel:80-85, members.ts:426-457 |
| D-WHO-09 | Blocked user in planned list | T1 blocked T2, T2 has a public trip | Open "Planned trips" | Blocked user's trip should be hidden. Current: still listed (D-D-30) | P3 | Edge | members.ts:188-245 |
| D-WHO-10 | Rapid clicks | T1 | Click Block confirm twice; click Turn on twice | Single user_blocks row (ON CONFLICT); no duplicate errors | P3 | Edge | members.ts:432-433 |
| D-WHO-11 | Privacy of public list | No token | GET /members/trips without Authorization | Returns public trips (records what is exposed: mt.* including user_id). Decide if acceptable | P3 | Security | members.ts:188, 245 |

### 3.3 Trip Mode and location consent

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-TM-01 | Enable and consent | T1, HTTPS, location permission not yet decided | 1) Safety > Location. 2) Click toggle. 3) Allow the browser prompt. | POST trip-mode {enabled:true} 200; browser asks permission; toggle on (aria-pressed true); first fix posted immediately; consent_records row granted (test DB only) | P1 | Safety | useTripMode:45-64, safety.ts:99-112 |
| D-TM-02 | Permission denied | T1, click Block in the browser prompt | Click toggle | Toggle should end OFF with a message and consent revoked. Current: toggle ON, error shown, consent stays granted (D-D-15) | P1 | Edge | useTripMode:48, 57-63 |
| D-TM-03 | Unsupported or insecure context | Open over http or a browser without geolocation | Click toggle | Error "Location is not supported in this browser."; server consent state should not stay granted | P3 | Edge | useTripMode:50-53 |
| D-TM-04 | Disable purges presence | T1 on, T2 in Near-you-now range | 1) T1 toggles off. 2) T2 reloads Near you now. | Watch cleared, POST enabled:false, T1 disappears at once; T1's later SOS has no location | P1 | Safety | useTripMode:66-75, safety.ts:103-105, geoPresence.ts:223-225 |
| D-TM-05 | State after refresh | T1 on | Reload the page, open Safety > Location | Toggle should reflect server state. Current: shows OFF while consent stays granted and last presence stays discoverable up to 24 h (D-D-9); no status GET exists | P1 | Safety | useTripMode:34-35, geoPresence.ts:192 |
| D-TM-06 | Tracking stops on navigation | T1 on in Location tab | Click Overview tab, then Explore, wait 6 min, check POST /safety/location calls | Tracking should continue while the app is open. Current: cleanup stops watch on unmount and never tells the server (D-D-9) | P1 | Edge | useTripMode:77-81, SafetyScreen:416 |
| D-TM-07 | Rapid toggle | T1 off | Double-click toggle within 200 ms, then click off | One watcher only; after off no further POST /safety/location. Current: second enable() leaks a watcher that is never cleared (D-D-15) | P2 | Edge | useTripMode:45-64 |
| D-TM-08 | Throttle | T1 on, DevTools sensors | Move 100 m within 5 min; then 300 m; then wait 5 min stationary | 100 m: no post; 300 m: post; 5 min: post | P2 | Edge | useTripMode:33-43 |
| D-TM-09 | Consent gate and roles (API) | T1, OP1, ADM tokens | 1) T1 without consent POST /safety/location. 2) OP1 and ADM POST /safety/location. 3) OP1 POST trip-mode. | 1) 403 "Location consent required...". 2) 403 "Only travelers...". 3) 200 (consent recorded though no location can be posted; toggle looks on but does nothing, D-D-24) | P1 | Security | safety.ts:40-47, 99-112 |
| D-TM-10 | Payload validation (API) | T1 with consent | POST /safety/location with lat 91, lng 181, accuracy -1; POST trip-mode with {} and {enabled:"yes"} | 400 "Validation error" each | P3 | Validation | safety.ts:12-21 |
| D-TM-11 | Consent prompt content | T1 | Read the Trip Mode card text | Wording states live location, tab-only, pause on close. It does not state the 24 h retention or that nearby members can see you; record as a disclosure gap for legal review | P2 | Safety | TripModeToggle:23-25, geoPresence.ts:192 |

### 3.4 Safety screen, trips and check-in

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-SAF-01 | Load and tabs | T1 with 1 trip, 2 contacts | Open Safety; click each tab | 4 GETs fire; tab labels show counts; every tab renders without console errors | P1 | UI | SafetyScreen:95-107, 248-272 |
| D-SAF-02 | Load failure visibility | T1 | Make one of the four GETs fail (local) | Should show an error. Current: silent empty state "No trips planned" and unused loading flag (D-D-25) | P3 | Edge | SafetyScreen:96-100, 69 |
| D-SAF-03 | Overview cards | T1 | Click Identity, Active trips, Emergency contacts cards | Jump to Identity, Trips, Contacts tabs | P2 | UI | SafetyScreen:294-308 |
| D-CHK-01 | Plan a trip happy path | T1 | 1) Trips tab > "+ Plan a trip". 2) Destination "Ubud", Start and End future dates, notes. 3) Save trip. | Trip saved and appears as "planned". Current: always alert "Could not save trip" because the API needs ISO datetimes (D-D-3) | P1 | UI | SafetyScreen:159-179, safety.ts:342-348 |
| D-CHK-02 | Plan validation | T1 | 1) Empty destination, Save. 2) Destination only, no dates. 3) End before start. | 1) UI should message; current: silently does nothing. 2) UI says dates optional but API requires them (400). 3) should be rejected | P2 | Validation | SafetyScreen:160, 343-344 |
| D-CHK-03 | Share with community off | T1 (after D-D-3 fixed) | Create trip with the checkbox cleared; T2 opens Travelers list | Trip must not be visible to T2. Current: is_public is ignored, DB default true (D-D-11) | P1 | Security | safety.ts:364-372, DB default is_public true |
| D-CHK-04 | Start trip | T1 planned trip (create via Trips > Travelers "I'm going") | Click "Start trip" | Status active; "Next check-in: now + 24 h" shown; Start button gone | P1 | UI | SafetyScreen:191-198, safety.ts:401-419 |
| D-CHK-05 | Start twice and other user | T1, T2 | 1) Double-click Start. 2) POST start on T2's trip id as T1. | 1) second request 404 and alert "Could not start trip." (acceptable but message should be clearer). 2) 404 | P2 | Security | safety.ts:410-413 |
| D-CHK-06 | Check in | T1 active trip | Click "Check in" | 201; alert "Checked in successfully!"; next due advances; trip_checkins row; status active | P1 | UI | SafetyScreen:181-189, safety.ts:422-477 |
| D-CHK-07 | Check-in access and validation (API) | T1, T2 | 1) tripId of a planned or completed trip. 2) T2's trip. 3) tripId "abc". 4) batteryPct 101. 5) note 201 chars. | 1-2) 404 "Active trip not found". 3-5) 400 | P1 | Security | safety.ts:350-356, 428-433 |
| D-CHK-08 | Rapid check-ins | T1 active | Click "Check in" 3 times quickly | Each accepted (no lock); no crash; next_checkin_due monotonic; note duplicates as a decision | P3 | Edge | SafetyScreen:396 |
| D-CHK-09 | Mark safe | T1 active or overdue | 1) Click "Mark safe", Cancel. 2) Click again, OK. | 1) nothing. 2) status completed and buttons disappear; completing a planned trip via API gives 404 | P1 | UI | SafetyScreen:200-208, safety.ts:478-494 |
| D-CHK-10 | Overdue detection and alert (SAFE TEST ONLY) | Local env, channels unset, trip active, next_checkin_due moved to the past in the test DB, contact TC with notify_on_overdue | Wait past the next check-in time | Status becomes overdue, banner shows on Overview and Trip card, TC is notified. Current: nothing changes and nobody is notified (D-D-4) | P1 | Safety | safety.ts (no writer of 'overdue'), SafetyScreen:318-322, 387-389 |
| D-CHK-11 | Recover from overdue | Local test DB with trip status overdue | Click "Check in" | Status back to active and banner disappears (backend supports it) | P2 | Safety | safety.ts:430, 455-463 |
| D-CHK-12 | Role and trip source | OP1, ADM, T1 | 1) OP1/ADM POST /safety/trips. 2) T1 creates trip through "I'm going" then opens Safety > Trips. | 1) 403 "Travelers only". 2) trip listed as planned and can be started | P2 | Security | safety.ts:361, members.ts:537 |
| D-CHK-13 | Date display | T1 with trip | View trip card | Dates readable. Current: shows raw ISO string for start_date (D-D-36); confirm at runtime | P3 | UI | SafetyScreen:377 |

### 3.5 Location sharing

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-LOC-01 | Share now with consent | T1 Trip Mode on | Location tab > "Share my location now" | 201, alert with coordinates, "Last shared" block shows time and coords, history refreshes. Current: page goes blank because latitude is undefined (D-D-2); confirm at runtime | P1 | UI | SafetyScreen:122-129, 426-431, safety.ts:63 |
| D-LOC-02 | Share now without consent | T1 Trip Mode never enabled | Click "Share my location now" | Clear message telling the user to enable Trip Mode. Current: "Request failed with status code 403" (D-D-14) | P1 | Edge | SafetyScreen:127-130, safety.ts:44-47 |
| D-LOC-03 | Permission denied | Browser blocks location | Click the button | Red banner and alert with the browser message; button re-enabled | P2 | Edge | SafetyScreen:118-134 |
| D-LOC-04 | Rapid clicks | T1 | Double-click the button | Disabled while getting location; one row | P3 | Edge | SafetyScreen:423 |
| D-LOC-05 | History | T1 with 0, then 12 locations | View list; click "View on map" | Empty state, then last 10 newest first; link opens maps.google.com in a new tab with noopener | P2 | UI | SafetyScreen:439-464 |
| D-LOC-06 | History API validation and isolation | T1, T2 | GET /safety/location/history?limit=abc; ?from=garbage; as T1 read only own rows | limit and dates invalid should give 400. Current: 500 (D-D-35). Never returns T2 data | P3 | Validation | safety.ts:73-90 |

### 3.6 SOS (all SAFE TEST ONLY: local backend, channels unset, or a TC mailbox with no phone; never a real number)

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-SOS-01 | Confirm dialog | T1 with 2 receives_sos contacts | Click "Send SOS"; Cancel; click again; OK | Dialog says "Send SOS alert to 2 emergency contact(s)?"; Cancel sends nothing; OK sends one POST | P1 | Safety | SafetyScreen:137-140 |
| D-SOS-02 | Happy path | T1, contact TC (email only) | Click Send SOS, OK | 201 {contacts_notified:1}; green "SOS sent. 1 contact(s) notified."; sos_events row trigger 'button'; sos_responders row; log shows subject, message, location link or "Location unavailable" | P1 | Safety | safety.ts:165-231, notifications.ts:99-146 |
| D-SOS-03 | Zero contacts | T3 no contacts | Click Send SOS, OK | Should warn "no contacts, call emergency services" in red. Current: green "SOS sent. 0 contact(s) notified." and an sos_events row is still created (D-D-10) | P1 | Safety | SafetyScreen:141, 285, safety.ts:207 |
| D-SOS-04 | Location included | T1 with Trip Mode on and a fresh fix, then Trip Mode off | Send SOS in each state | On: maps link with coordinates. Off: "Location unavailable" (card says "with your location") | P2 | Safety | safety.ts:170-172, SafetyScreen:284 |
| D-SOS-05 | Rapid clicks | T1 | Click OK on dialog then click button again while "Sending..." | Only one request while loading; a second later SOS creates a second event | P2 | Edge | SafetyScreen:287 |
| D-SOS-06 | Failure path | Local backend stopped | Click Send SOS | Red "Could not send SOS. Please call emergency services directly." with no numbers shown (D-D-23); spinner clears | P1 | Safety | SafetyScreen:142-146 |
| D-SOS-07 | Roles | ADM, OP1 | Open Safety as ADM; click Send SOS; POST /safety/sos as OP1 | 403 "Only travelers can trigger SOS"; UI shows only the generic failure text (D-D-24) | P2 | Security | safety.ts:167, AppShell:74-85 |
| D-SOS-08 | Contact flags and channels | T1 with contacts: receives_sos false (API), email-only, phone-only invalid ("abc") | Send SOS | receives_sos false contact not notified; phone-only invalid gives sos_responders method 'failed' but UI still reports N notified | P2 | Safety | safety.ts:174-180, notifications.ts:134 |
| D-SOS-09 | Follow-up endpoints security | T1, T2, an sos id of T1 | 1) GET /safety/sos/<id>/stream with no token. 2) POST /safety/sos/<id>/resolve as T2. 3) POST /safety/sos/<id>/ping {latitude:0,longitude:0} as T1. | 1) should be 401 (Current: 200 stream with last_known coordinates, D-D-12). 2) should be 404/403 (Current: 200 and emits a false 'resolved' event that ends the stream, D-D-13). 3) 0 coordinates should be accepted (Current: 400, D-D-35) | P1 | Security | safety.ts:499-588 |
| D-SOS-10 | No cancel or refresh | T1 | Send SOS, reload page | Result message is gone and there is no way to resolve or mark a false alarm from the UI (D-D-23) | P2 | Safety | SafetyScreen:68, safety.ts:536 |

### 3.7 Emergency contacts

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-CON-01 | Add contact | T1 | Contacts > "+ Add contact"; Name "Test Contact", email TC, relationship; Add | Card with initial, email, relationship, SOS and Location badges; tab count increments; POST 201 | P1 | UI | SafetyScreen:210-233, safety.ts:114-133 |
| D-CON-02 | Add phone-only (SAFE TEST ONLY) | T1 local env | Add contact with phone "+61400000000" (fake test value, channels unset) and no email | Saved; detail shows phone; no SMS sent in local env | P2 | Safety | safety.ts:118 |
| D-CON-03 | Required fields | T1 | 1) Empty name. 2) Name only. 3) Whitespace name with email. | 1-2) alert "Name and email or phone required." and no request. 3) rejected | P1 | Validation | SafetyScreen:211-214 |
| D-CON-04 | Server validation | T1 | Email "not-an-email"; phone 21 chars; name 101 chars; relationship 51 chars | 400 and alert "Could not add contact." (no field detail) | P2 | Validation | safety.ts:23-32 |
| D-CON-05 | Delete | T1 with contact | 1) Click X, Cancel. 2) Click X, OK. 3) Repeat delete with API on same id. | 1) kept. 2) removed. 3) 404, UI would show nothing (errors swallowed) | P1 | UI | SafetyScreen:235-241, safety.ts:151-163 |
| D-CON-06 | Cross-user delete and read | T1, T2 | DELETE /safety/contacts/<T2 contact id> as T1; GET /safety/contacts as T1 | 404; only own contacts returned | P1 | Security | safety.ts:154, 141 |
| D-CON-07 | Edit contact | T1 | Look for edit control; PATCH or PUT /safety/contacts/:id | None exists in UI or API; flags can_see_location, receives_sos, notify_on_overdue cannot be changed (D-D-22) | P2 | Edge | SafetyScreen:217-224 |
| D-CON-08 | Double click add | T1 | Double-click "Add contact" | Disabled while saving; one row | P2 | Edge | SafetyScreen:487 |
| D-CON-09 | XSS in fields | T1 | Name `<img src=x onerror=alert(1)>` | Rendered as text, no alert | P2 | Security | SafetyScreen:506 |
| D-CON-10 | Roles (API) | OP1 | POST /safety/contacts; GET /safety/contacts | POST 403 "Only travelers can add safety contacts"; GET returns [] | P2 | Security | safety.ts:116 |

### 3.8 Reports, block, emergency numbers, identity

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-RPT-01 | Severity 4 categories (SAFE TEST ONLY) | Local backend, reviewer email and phone unset; T1; target traveler id (travelers.id) | POST /safety/reports with category harassment, then safety_concern, description 20 chars | 201 {reportId}; row severity 4; log shows "REVIEWER ALERT (URGENT)"; nothing sent locally. Never run against production | P1 | Safety | safety.ts:611-647 |
| D-RPT-02 | Severity 3 and 2 and 1 categories | Local env | POST category scam, operator_misconduct (severity 3, operator target), fake_profile, inappropriate_content, no_show (2), other (1) | 201 each; severity stored per map; no reviewer alert | P1 | API | safety.ts:611-614 |
| D-RPT-03 | Targets | Local env | 1) No target. 2) reportedOperatorId of a real operator. 3) reportedPlaceCacheId of a places_cache row. 4) tripId random uuid. | 1) 400 "Must report a traveler, operator, or place". 2-3) 201. 4) FK error 500 (should be 400) | P2 | Validation | safety.ts:607-609, DB FKs |
| D-RPT-04 | Field validation | Local env | description 9 chars and 2001 chars; category "spam"; isAnonymous "yes" | 400 "Validation error" each | P2 | Validation | safety.ts:592-601 |
| D-RPT-05 | Anonymous flag | Local env | Send isAnonymous true | Accepted but not stored (no column); reporter_id is still recorded. Confirm this is disclosed to reporters | P2 | Safety | safety.ts:616-620 |
| D-RPT-06 | Reporter role | OP1, ADM | POST /safety/reports | Should be a clear 403. Current: 500 because INSERT...SELECT from travelers returns no row (D-D-24) | P3 | Security | safety.ts:621-635 |
| D-EMG-01 | Emergency numbers API | T1 token | GET /safety/emergency-numbers?country=AU and country=au; missing country; country=ZZ; no token | AU and au: 200 {country, numbers[]}; missing: 400; ZZ: 404; no token: 401 | P2 | API | safety.ts:693-718 |
| D-EMG-02 | UI presence | T1 | Search Safety screen for emergency numbers | No control exists although the SOS failure text tells the user to call emergency services (D-D-23) | P2 | Safety | SafetyScreen (no caller) |
| D-VER-01 | Identity tab | T1 | Open Identity; click "Start verification"; click again | Alert "Verification initiated (ID ...) Stripe Identity integration pending"; status Pending; second click returns already_pending; button remains; never completes (D-D-26) | P2 | UI | SafetyScreen:149-157, safety.ts:273-305 |
| D-VER-02 | Status labels | T1 test DB with status requires_input and verified | View tab | requires_input should have a label (Current: "Unknown", D-D-38); verified hides the button | P3 | UI | SafetyScreen:245-246, 535 |
| D-VER-03 | Non-traveller | OP1, ADM | POST /safety/verification/initiate | Should be 403. Current: 500 (no travelers row) | P3 | Security | safety.ts:288-299 |

### 3.9 Safety Line voice agent (webhook API only, no settings UI)

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-VOI-01 | Auth of webhooks | Local backend with a test VOICE_WEBHOOK_SECRET | POST /voice/call-started with no header, wrong header, correct header; also with the variable unset | 401, 401, 201; unset gives 503 "Voice agent not configured" | P1 | Security | requireWebhookSecret.ts:11-20 |
| D-VOI-02 | Call started and replay | Local env, test user T1 phone stored in travelers.phone | POST call-started {callerPhone, platformCallId:"qa-1"} twice | 201 with callId, sosEventId, caller; second gives same ids (idempotent); unknown phone gives caller.userId null | P1 | API | voiceAgent.ts:36-50, services/voiceAgent.ts:60-100 |
| D-VOI-03 | Phone matching | Local env, T1 phone "+61400000000" | Call with "0400000000" and with "+61 400 000 000" | Exact string match only, so formatted variants are unidentified (P2 product risk) | P2 | Edge | services/voiceAgent.ts:32-38 |
| D-VOI-04 | Validation | Local env | Missing callerPhone; lookup with 3-letter country; contacts with non-uuid callId; call-ended with outcome "maybe" | 400 each | P2 | Validation | voiceAgent.ts:25-29, 52-55, 75, 112-117 |
| D-VOI-05 | Emergency number lookup | Local env | lookup-emergency-number for ID and for an unseeded code | 200 numbers[]; unseeded 404; sos_ai_calls.country_code_used and emergency_number_given updated | P2 | API | voiceAgent.ts:60-73 |
| D-VOI-06 | Contacts and bridge | Local env | POST contacts for an unidentified call; then for T1's call; POST bridge-attempted {connected:true} | [] then T1's receives_sos contacts (name and phone); 204 and flags set | P2 | API | voiceAgent.ts:82-110 |
| D-VOI-07 | Call end (SAFE TEST ONLY) | Local env channels unset, T1 with zero contacts | POST call-ended with false_alarm, then a new call with genuine_emergency, then unknown callId | false_alarm: no escalation and no notification. genuine_emergency: escalated_at set, reviewer alert logged (nothing sent). unknown callId: currently 500 (should be 404). Never against production | P1 | Safety | services/voiceAgent.ts:168-170, 257-327 |
| D-VOI-08 | Settings UI | Any account | Look for Safety Line settings in web app | None exist; configuration is env only (VOICE_WEBHOOK_SECRET, SAFETY_REVIEWER_*, LIVEKIT_*) (D-D-40) | P3 | Edge | voiceWorker/index.ts:62-85, agent.ts:217-218 |

### 3.10 Operator dashboard and bookings

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-DSH-01 | Landing and nav | OP1 | Sign in | Lands on Dashboard; nav shows only Dashboard, Bookings, Profile | P1 | UI | AppShell:41, 68-73 |
| D-DSH-02 | Dashboard load | OP1 with 2 bookings and 1 review | Open Dashboard | Business name, tier, region, 6 metric cards, tabs. Current: shows "No operator profile found. Create your listing first." because /dashboard/bookings and /dashboard/reviews return 500 (D-D-1); confirm at runtime | P1 | UI | DashboardScreen:19-46, dashboard.ts:72, 99 |
| D-DSH-03 | Metrics correctness (after fix) | OP1 with pending 1, confirmed 1, completed 1 (amount 100), cancelled 1, reviews 5 and 3 | Compare cards with DB counts | Pending, confirmed, completed counts match; revenue counts completed only; average rating 4.0; total reviews 2 | P1 | API | dashboard.ts:28-34 |
| D-DSH-04 | Bookings tab actions | OP1 pending booking | 1) Click Confirm. 2) Click "Mark completed". 3) On another pending, click Decline. | Pill changes confirmed then completed then cancelled; buttons update; PATCH 200 | P1 | UI | DashboardScreen:34-41, 153-169 |
| D-DSH-05 | Action errors | OP1, booking already completed in another tab | Click Confirm on stale card | API 400 "Cannot update a completed booking"; UI should show it. Current: silently console.error (D-D-42) | P3 | Edge | DashboardScreen:38-40, bookings.ts:213-215 |
| D-DSH-06 | Rapid clicks | OP1 | Double-click Confirm | Idempotent (confirmed to confirmed allowed); no duplicate side effects | P3 | Edge | bookings.ts:212-215 |
| D-DSH-07 | Reviews tab | OP1 with reviews | Open Reviews | Stars, title (see D-REV), body, date and guests | P2 | UI | DashboardScreen:177-197 |
| D-DSH-08 | No operator profile | OP0 | Open Dashboard | 404 overview leads to the "Create your listing first" text; no create-listing UI exists | P2 | Edge | dashboard.ts:43-45, DashboardScreen:46 |
| D-DSH-09 | Empty states and rating maths | OP1 with no bookings or reviews | Open each tab | "No booking activity yet.", "No bookings yet.", "No reviews yet."; no NaN widths | P3 | Edge | DashboardScreen:95-96, 114-121 |
| D-DSH-10 | Role isolation | T1, ADM, no token | GET /dashboard/overview, /bookings, /reviews, /analytics, /claims | T1 and ADM: 403 "Operator access required". No token: 401 | P1 | Security | dashboard.ts:8-14 |
| D-DSH-11 | Booking status permissions (API) | OP1, OP2, T1, T2 with bookings | 1) OP2 PATCH OP1's booking. 2) T1 PATCH own booking to confirmed. 3) T1 cancel own. 4) T2 cancel T1's booking. 5) status "pending". | 1) 403. 2) 403 "Travelers can only cancel". 3) 200. 4) 403. 5) 400 | P1 | Security | bookings.ts:196-210, 18-20 |
| D-DSH-12 | Notification on status change | OP1 confirms T1's booking | Check T1 email or in-app | Traveller should be told. Current: no notification (sendBookingNotification only logs and is never called, D-D-27) | P3 | Edge | notifications.ts:176-201 |
| D-DSH-13 | Listing edit (API only) | OP1, OP2, ADM | PATCH /operators/:id own; other operator's id; as ADM; invalid website; empty body; latitude without longitude | Own 200; others 404; ADM 404; invalid URL 400; empty 400 "No fields to update"; lone latitude ignored | P2 | API | operators.ts:420-467 |
| D-DSH-14 | Claims flow (API only) | OP1, ADM | POST /operators/claims, GET /operators/claims, GET /operators/claims/queue as ADM, PATCH /operators/claims/:id | Should work end to end. Current: 500 on every call, columns missing in listing_claims (D-D-8) | P2 | API | operators.ts:125-235, 303-333 |
| D-DSH-15 | Offers and tiers | OP1 | Look for offers or tier management | None (offers.ts has only GET /offers/place/:placeId; tier is read-only badge) (D-D-23) | P3 | Edge | offers.ts:12, DashboardScreen:54 |
| D-DSH-16 | Operator Bookings screen | OP1 | Open Bookings in nav | Shows guest name and dates with actions. Current: card title blank (business_name missing) and no actions (D-D-28) | P2 | UI | BookingsScreen:21, 45, bookings.ts:111-121 |

### 3.11 Bookings and reviews API (no UI for create)

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-BKG-01 | Create booking | T1, operator id | POST /bookings {operator_id, start_date:'2026-12-01', guests:2, total_amount:100} | 201 with operator_name | P2 | API | bookings.ts:24-89 |
| D-BKG-02 | Create validation | T1, OP1 | Past date; end before start; guests 0 and 51; unknown operator; negative amount; currency 'AU'; OP1 posting | 400, 400, 400, 404, 400, 400, 403 | P2 | Validation | bookings.ts:8-16, 26-58 |
| D-BKG-03 | Read access | T1, OP1, T2, ADM | GET /bookings per role; GET /bookings/:id of another user's booking | Traveller and operator get own; ADM 403; other user 403 | P2 | Security | bookings.ts:93-168 |
| D-REV-01 | Submit review | T1 with completed booking | POST /reviews {booking_id, rating:5, title, body} | 201. Current: 500 "column title does not exist" (D-D-7) | P2 | API | reviews.ts:59-73 |
| D-REV-02 | Read reviews | Any | GET /reviews/operator/:id and GET /reviews/me | 200 with stats and reviews. Current: 500 (D-D-7) | P2 | API | reviews.ts:92, 133 |
| D-REV-03 | Review rules | T1, OP1 | Review a non-completed booking; second review; OP1 posting; body 9 chars | 400, 409, 403, 400 (after D-D-7 fixed) | P3 | Validation | reviews.ts:19-50 |

### 3.12 Public waitlist form

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-WLP-01 | Reach the form | Logged out | Landing > Sign in > "Join the waitlist"; also click Landing "Join free" | Waitlist form from the login link; "Join free" goes to register, not the waitlist | P2 | UI | LoginScreen:149, 404 |
| D-WLP-02 | Happy path | Logged out | Name "QA", email qa1@example.test, destination "Bali", click Join | Button "Joining..."; success "You're on the list."; waitlist row status waiting, source direct, destination Bali | P1 | UI | LoginScreen:102-114, waitlist.ts:50-64 |
| D-WLP-03 | Validation | Logged out | 1) Empty email. 2) "foo". 3) name 101 chars. 4) destination 101 chars. | 1) "Please enter your email address" (no request). 2) "Invalid email address." 3-4) API 400 but shows the misleading "Invalid email address." (D-D-32) | P1 | Validation | LoginScreen:103, waitlist.ts:66-68 |
| D-WLP-04 | Duplicates | Existing waiting entry, existing joined entry, existing user email | Submit each; also same email in different case | 409 with the right message each (already on waitlist, account exists, account exists); case-insensitive | P1 | Validation | waitlist.ts:26-48 |
| D-WLP-05 | Rapid submit | Logged out | Double-click Join; two concurrent POST /waitlist with same new email | UI button disabled. API: one 201 and the other 409 (Current risk: unique-index race returns 500, D-D-32) | P2 | Edge | LoginScreen:201-204, waitlist.ts:27-60 |
| D-WLP-06 | Enter key and refresh | Logged out | Press Enter in name field, email field, destination field; reload mid-form | Enter submits from email and destination only; reload resets to landing | P3 | UI | LoginScreen:180-197 |
| D-WLP-07 | Network error | API blocked (local) | Submit | Generic error text shown; button re-enabled | P2 | Edge | LoginScreen:109-113 |
| D-WLP-08 | Invite link | Approved entry (test env), logged out | Open /invite/<token>; then an expired token; then a random token | Valid: register form with locked email and banner. Expired: 410 message and login. Random: "invalid or has expired" | P1 | UI | LoginScreen:28-52, waitlist.ts:97-130 |
| D-WLP-09 | Invite consumption | Same as D-WLP-08 | Register through the invite; check waitlist row | Row becomes joined and invite_used_at set. Current: /waitlist/use-invite 404 swallowed, status stays invited, link reusable (D-D-17) | P1 | Edge | LoginScreen:93, waitlist.ts (no route) |
| D-WLP-10 | Expired invite recovery | Entry invited with expired token | Submit the waitlist form again with the same email | Should be able to obtain a new link. Current: 409 "already on the waitlist" and admin has no re-approve button (D-D-18) | P2 | Edge | waitlist.ts:32-38, 117-119, AdminWaitlist:119 |
| D-WLP-11 | Enumeration and abuse | No token | GET /waitlist/check?email=x@y.z for known and unknown; 50 rapid POST /waitlist | Discloses status for any email (D-D-29); POST has only the global 300/min limit | P2 | Security | waitlist.ts:76-93, rateLimit.ts:136 |
| D-WLP-12 | Script in fields | Logged out | Name `<script>alert(1)</script>`, note via API | Stored as text; admin React page escapes it (see D-ADM-10) | P2 | Security | waitlist.ts:51-59 |

### 3.13 Admin waitlist

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-ADM-01 | Admin button | ADM | Click "Admin" in sidebar | Opens the admin waitlist. Current: /admin.html is not in web/dist and the nginx .html location returns 404 (D-D-5); confirm with one GET | P1 | UI | AppShell:167-172, nginx sites-enabled/drift |
| D-ADM-02 | Direct URLs | ADM | Open /admin, /admin/waitlist, /admin.html | /admin/waitlist renders AdminWaitlist through the SPA fallback; /admin redirects to /admin.html | P1 | UI | App.web.tsx:11, 39 |
| D-ADM-03 | Not signed in | Logged out | Open /admin/waitlist | API 401, refresh fails, redirect to "/" (login); no data shown | P1 | Security | api.web.ts:37-52 |
| D-ADM-04 | Non-admin signed in | T1, OP1 | Open /admin/waitlist | Page shell appears, banner "Could not load waitlist. Make sure you are signed in as admin."; API 403; no entries | P1 | Security | AdminWaitlist:35, waitlist.ts:135-147 |
| D-ADM-05 | List and counts | ADM, entries in each status | Open page | Header "N total · a waiting · b invited · c joined"; tabs show counts; rows show name, email, source tag, date, note, status | P1 | UI | AdminWaitlist:67-125 |
| D-ADM-06 | Filters and empty | ADM | Click Invited, Joined (empty) | Correct rows; "No joined entries." message; there is no "approved" or "all" filter and no search | P2 | UI | AdminWaitlist:83-95 |
| D-ADM-07 | Approve (SAFE TEST ONLY) | Local env with SENDGRID_API_KEY unset, or entry email is a TC mailbox | Click Approve on a waiting row | Status invited, 7-day token, approved_at set; row leaves Waiting; email logged or sent to TC; invite link visible under Invited tab | P1 | Safety | AdminWaitlist:41-49, waitlist.ts:187-231 |
| D-ADM-08 | Copy link | ADM, invited row | Click "Copy link" | Label "Copied" for 2 s; clipboard holds https://.../invite/<token>; on http the copy fails silently | P3 | UI | AdminWaitlist:51-55, 134-137 |
| D-ADM-09 | Double approve | ADM, local env | Double-click Approve; API approve twice | Second call must be refused or return the same token. Current: new token replaces the first and a second email goes out (D-D-19) | P2 | Edge | waitlist.ts:201-217 |
| D-ADM-10 | Escaping | ADM, entry name and note contain HTML | View list | Displayed as text. (The static admin.html would execute it, but it is not deployed, D-D-33) | P1 | Security | AdminWaitlist:105-113, admin.html:134-140 |
| D-ADM-11 | Approve errors | ADM | Approve unknown uuid, non-uuid, a joined entry (API) | 404 "Not found"; non-uuid 500 (should be 400); 409 already has an account; banner shows message and stays after later success (D-D-39) | P3 | Validation | waitlist.ts:190-203, AdminWaitlist:79 |
| D-ADM-12 | Missing controls | ADM | Look for export, manual invite, renew invite, reject, delete | None exist; record as gaps | P3 | Edge | AdminWaitlist:82-90 |
| D-ADM-13 | Filter injection | ADM | GET /admin/waitlist?status=' OR '1'='1 | Parameterised; returns [] | P2 | Security | waitlist.ts:161-164 |
| D-ADM-14 | Large list | ADM, 2000 entries | Open page | Loads; note there is no pagination and results are unbounded | P3 | Edge | waitlist.ts:165 |

### 3.14 Role isolation matrix

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-ROL-01 | Traveller vs admin-only API | T1 token | POST /trips, PATCH /trips/:id, GET /trips/:id/rsvps, GET /admin/waitlist, POST /admin/waitlist/:id/approve, PATCH /operators/claims/:id, GET /operators/claims/queue | 403 for each | P1 | Security | trips.ts:35-41, waitlist.ts:135-147, operators.ts:223, 305 |
| D-ROL-02 | Traveller vs operator-only API | T1 token | GET /dashboard/*, POST /operators, POST /operators/claims, PATCH /operators/:id | 403 or 404 (not yours); no data leak | P1 | Security | dashboard.ts:8-14, operators.ts:127, 369, 420 |
| D-ROL-03 | Operator or admin vs traveller-only API | OP1, ADM tokens | POST /bookings, POST /reviews, POST /safety/sos, /safety/contacts, /safety/trips, /safety/location | 403 each; POST /safety/reports and /verification/initiate should be 403 (Current: 500, D-D-24) | P1 | Security | bookings.ts:26, reviews.ts:19, safety.ts:40, 116, 167, 361 |
| D-ROL-04 | Unauthenticated | No token | Call every protected route above; then public ones (POST /waitlist, GET /waitlist/check, GET /waitlist/invite/:t, GET /safety/operators/:id/trust, GET /reviews/operator/:id, GET /safety/sos/:id/stream, GET /members/trips) | Protected: 401. Public list as documented; the SOS stream must not be public (D-D-12) | P1 | Security | safety.ts:561, 663; members.ts:188 |
| D-ROL-05 | UI hiding consistency | T1, OP1, ADM | Inspect nav for each role | Operator: no Trips or Safety. Admin: sees Safety and its SOS button although the API refuses (D-D-24). Trips admin buttons only for admin | P2 | Security | AppShell:68-85 |
| D-ROL-06 | Stale role in UI | ADM demoted in test DB | Keep the session open; click Trips and "+ New trip" | UI still shows admin controls until reload (role comes from stored user), API returns 403 on use | P3 | Security | TripsScreen:63, authenticate.ts:56-65 |
| D-ROL-07 | IDOR | T1, T2 ids | Access T2's contacts, trips, history, SOS, bookings, RSVP list using T1 token | 404 or 403 everywhere; no T2 data | P1 | Security | safety.ts:141, 389, 505; bookings.ts:156-160 |
| D-ROL-08 | Deactivated user | Test user is_active false, old token | Call any route | 401 "Account not found or deactivated" | P2 | Security | authenticate.ts:56-63 |

### 3.15 Mobile layout (375 x 812, then 768)

| ID | Area | Precondition/test data | Steps | Expected result | Priority | Type | Source |
|---|---|---|---|---|---|---|---|
| D-MOB-01 | Shell | T1, width 375 | Open drawer, switch tabs | Hamburger works, drawer closes on selection and backdrop tap | P1 | Mobile | AppShell:106-125 |
| D-MOB-02 | Trips | T1/ADM, 375 | View grid, RSVP, open Create modal | Single column; modal fits with margins (Current styles: page padding 32/40 and an overlay with no padding, so the modal may touch the edges; runtime check, D-D-31); two date fields side by side remain usable | P2 | Mobile | TripsScreen:335, 362-363, 367 |
| D-MOB-03 | Safety | T1, 375 | Open each tab; Overview | Tab strip should not overflow the page (five tabs, no wrap or scroll set); status cards should stack (three-column grid); SOS card should wrap; contact and trip forms (two-column grid) usable | P1 | Mobile | SafetyScreen:570, 577, 584, 601 |
| D-MOB-04 | SOS tap | T1, 375 | Tap Send SOS | Button reachable without scrolling sideways; confirm dialog readable; result text visible | P1 | Mobile | SafetyScreen:281-290 |
| D-MOB-05 | Location prompts | T1 on iOS Safari and Android Chrome (HTTPS) | Toggle Trip Mode, share location | Permission prompt appears; denial handled (D-TM-02); note locking the phone pauses updates | P1 | Mobile | useTripMode:57-62 |
| D-MOB-06 | Dashboard | OP1, 375 | Open each tab | Metric cards wrap (auto-fill 130 px); booking cards and Confirm/Decline buttons usable | P2 | Mobile | DashboardScreen:211 |
| D-MOB-07 | Admin and waitlist form | ADM and logged out, 375 | Open /admin/waitlist and the waitlist form | Rows readable, invite URL wraps or scrolls, Copy link tappable; form fields full width | P3 | Mobile | AdminWaitlist styles, LoginScreen:158-215 |

## 4. Suspected defects

Severity: 1 critical (feature dead or safety promise false), 2 major, 3 moderate, 4 minor.

| ID | Severity | What is wrong | Evidence file:line | Confirmed by code or needs runtime check |
|---|---|---|---|---|
| D-D-1 | 1 | Operator dashboard never loads. Promise.all includes /dashboard/bookings (joins table traveler_preferences that does not exist) and /dashboard/reviews (selects reviews.title, column does not exist). Both 500, so overview stays null and every operator sees "No operator profile found. Create your listing first." Operators therefore cannot confirm, decline or complete bookings from the UI | dashboard.ts:72, 99; DashboardScreen.web.tsx:20-31, 46, 155-165; live \d: no traveler_preferences, reviews has no title; deployed dist/routes/dashboard.js contains both | Confirmed by code and schema; runtime check to see the message |
| D-D-2 | 1 | Safety "Share my location now" crashes the screen. POST /safety/location returns only {id, recorded_at}, UI stores it as a LocationPoint and renders currentLocation.latitude.toFixed(4); no ErrorBoundary exists in web/src, so the whole app goes blank | safety.ts:63; SafetyScreen.web.tsx:122-123, 429; grep ErrorBoundary web/src: none | Confirmed by code; runtime check for the blank screen |
| D-D-3 | 1 | Safety "Plan a trip" always fails. Backend requires start_date and end_date as full ISO datetimes; UI sends YYYY-MM-DD or omits them. Checked with repo zod: date-only false, missing false, ISO true. Only route to a check-in trip is Trips > Travelers > "I'm going" | safety.ts:342-348, 362; SafetyScreen.web.tsx:163-170, 343-344 | Confirmed by code and zod run |
| D-D-4 | 1 | Missed check-ins are never detected. Nothing in the backend sets safety_status 'overdue' or 'escalated' and there is no scheduler, so contacts are never notified though the UI promises it and the overdue UI is unreachable | grep of backend/src: only safety.ts start, checkin, complete write safety_status; SafetyScreen.web.tsx:318-322, 387-389, 498; safety_contacts.notify_on_overdue never read | Confirmed by code and grep |
| D-D-5 | 2 | Admin link is a 404. Sidebar opens /admin.html and /admin redirects to it, but /admin.html is not in web/dist and the nginx regex location for .html uses try_files $uri =404. Static admin.html exists only in web/src/screens (find /) and is never copied. The React AdminWaitlist is reachable only via paths like /admin/waitlist | AppShell.web.tsx:168; nginx /etc/nginx/sites-enabled/drift (location = /admin, location ~* \.html$); ls web/dist; webpack.config.js (no copy plugin) | Confirmed by config; one GET recommended |
| D-D-6 | 2 | Reporting someone from "Near you now" fails. UI sends users.id as reportedTravelerId but safety_reports.reported_traveler_id references travelers(id) | WhosGoingPanel.tsx:72-75; members.ts:88; live \d safety_reports FK reported_traveler_id to travelers | Confirmed by schema; runtime check with two accounts |
| D-D-7 | 2 | Whole reviews API is broken: INSERT and both SELECTs use reviews.title, which does not exist. No UI calls it, and it also feeds D-D-1 | reviews.ts:59-73, 92, 133; live \d reviews | Confirmed by schema |
| D-D-8 | 2 | Listing-claim endpoints use columns that do not exist (place_cache_id, operator_id, evidence, reviewed_at); live listing_claims has id, place_id, user_id, status, created_at. No UI | operators.ts:125-235, 303-333; dashboard.ts:120-139 | Confirmed by schema |
| D-D-9 | 2 | Trip Mode state is per component and lost on refresh or navigation. Toggle shows OFF after reload while consent stays granted; unmount clears the watch without telling the server; presence stays visible to nearby members for up to 24 h. No GET status route. UI copy says "while Drift is open in this tab" | useTripMode.web.ts:34-35, 77-81; geoPresence.ts:192, 213-217; safety.ts:99-112; TripModeToggle.web.tsx:23-25 | Confirmed by code; runtime check |
| D-D-10 | 2 | SOS with no contacts reports success and does not warn. Green "SOS sent. 0 contact(s) notified." while nothing is sent; the card also says "with your location" though location exists only if Trip Mode cached a fix | SafetyScreen.web.tsx:141, 284-285; safety.ts:170-172, 207 | Confirmed by code |
| D-D-11 | 2 | "Share with community" is ignored on Safety trips. is_public and region are dropped by zod and the INSERT does not set is_public, so the DB default true applies and the trip and notes become public. Latent until D-D-3 is fixed | SafetyScreen.web.tsx:169, 349; safety.ts:342-348, 364-372; member_trips.is_public default true | Confirmed by code and schema |
| D-D-12 | 3 | SOS live stream has no authentication: anyone with an SOS id gets last_known_lat and lng and live pings. No route or email gives contacts a tracking link, so the feature is neither usable nor safe | safety.ts:561-588 (no authenticate); notifications.ts:105-115 (no link) | Confirmed by code |
| D-D-13 | 3 | POST /sos/:id/resolve and /ping: resolve returns success and emits SSE events even if the id is not the caller's; a false 'resolved' event ends the contacts' stream. ping rejects 0 coordinates. No UI for resolve or ping | safety.ts:502, 536-558 | Confirmed by code |
| D-D-14 | 3 | Location tab button fails for users who have not toggled Trip Mode; UI shows axios text "Request failed with status code 403" instead of the backend message | SafetyScreen.web.tsx:127-130; safety.ts:44-47 | Confirmed by code |
| D-D-15 | 3 | Trip Mode enable: permission denial leaves toggle ON with an error and consent granted; rapid clicks create untracked watchers | useTripMode.web.ts:45-64 (setEnabled after watchPosition regardless of errors; watchIdRef overwritten) | Confirmed by code; runtime check |
| D-D-16 | 3 | "Turn on" then immediate nearby load races the first location post, so the "Turn on Trip Mode" prompt can reappear | WhosGoingPanel.tsx:152; useTripMode.web.ts:45-64; members.ts:75-78 | Needs runtime check |
| D-D-17 | 3 | POST /waitlist/use-invite does not exist: the call is swallowed, waitlist rows never become 'joined', the Joined tab is always empty and invites are reusable until expiry | LoginScreen.web.tsx:93; waitlist.ts (no such route; grep of backend/src) | Confirmed by code |
| D-D-18 | 3 | Expired invite is a dead end: the page says to join the waitlist again, the API answers 409 for an existing email, and the admin UI shows Approve only for status waiting | waitlist.ts:32-38, 117-119; AdminWaitlist.web.tsx:119 | Confirmed by code |
| D-D-19 | 3 | Admin approve has no in-flight guard and no status guard: a second approve replaces the token (first link dies) and sends another email | AdminWaitlist.web.tsx:41-49; waitlist.ts:190-224 | Confirmed by code |
| D-D-20 | 3 | RSVP modal shows the previous trip's RSVPs when the next load fails (rsvps not reset, error banner hidden behind overlay) | TripsScreen.web.tsx:116-127, 162, 234-255 | Confirmed by code |
| D-D-21 | 3 | No UI or API for editing, cancelling, deleting or drafting curated trips or viewing a trip; PATCH exists but has no caller, no DELETE route; cancelled trips vanish from every list | trips.ts:83, 134-164; TripsScreen.web.tsx:275 | Confirmed by code |
| D-D-22 | 3 | Emergency contacts cannot be edited and flags are hardcoded true; no PATCH route | SafetyScreen.web.tsx:217-224; safety.ts (routes 114-163 only) | Confirmed by code |
| D-D-23 | 3 | Features with an endpoint but no UI: emergency numbers, other report categories and report a place or operator, unblock (dialog promises undo), SOS resolve or track, Safety Line settings, offers, tier and listing edit, reviews. SOS failure text says call emergency services but shows no number | safety.ts:693, 604; members.ts:444; WhosGoingPanel.tsx:81; SafetyScreen.web.tsx:143 | Confirmed by grep of web/src |
| D-D-24 | 3 | Admin sees Safety and SOS which always 403; POST /safety/reports and /verification/initiate return 500 for non-travellers (INSERT...SELECT yields no row, then rows[0].id); Trip Mode consent is accepted for any role | AppShell.web.tsx:74-85; safety.ts:40, 167, 288-299, 621-635, 99-112 | Confirmed by code |
| D-D-25 | 3 | Safety load swallows every error and the loading flag is never rendered, so failures look like empty data | SafetyScreen.web.tsx:69, 95-107 | Confirmed by code |
| D-D-26 | 3 | Identity verification is a stub: creates a pending row forever, button stays, alert says integration pending | safety.ts:287-299; SafetyScreen.web.tsx:149-157 | Confirmed by code |
| D-D-27 | 3 | No notification on booking changes: sendBookingNotification only console.logs and is never called | notifications.ts:176-201; bookings.ts (no import) | Confirmed by code |
| D-D-28 | 3 | Operators have no working booking management outside the dead dashboard: BookingsScreen renders business_name which the operator query does not return, has no actions; travellers have no UI to create or cancel bookings | BookingsScreen.web.tsx:21, 45; bookings.ts:111-121; grep web/src for POST /bookings: none | Confirmed by code |
| D-D-29 | 3 | Public GET /waitlist/check reveals whether any email is on the list; POST /waitlist has no dedicated rate limit | waitlist.ts:76-93; index.ts:53; rateLimit.ts:136 | Confirmed by code |
| D-D-30 | 3 | Blocked users still appear in "Planned trips" | members.ts:188-245 (no user_blocks filter, unlike :288) | Confirmed by code |
| D-D-31 | 3 | Mobile layout risks: five-tab strip, three-column status grid, non-wrapping SOS card, two-column forms, modal overlay without padding | SafetyScreen.web.tsx:570, 577, 584, 601; TripsScreen.web.tsx:335, 362-363 | Needs runtime check |
| D-D-32 | 4 | Waitlist: any validation error shows "Invalid email address."; duplicate check then insert can race into a 500 on the unique email index | waitlist.ts:27-60, 66-68 | Confirmed by code; race needs runtime |
| D-D-33 | 4 | Static admin.html injects name, email and note with innerHTML (stored XSS, and inline onclick with email); currently not deployed | admin.html:129-154 | Confirmed by code; latent |
| D-D-34 | 4 | Signup is open, so waitlist approval and invite links do not gate anything | LoginScreen.web.tsx:234-235; rateLimit.ts:112-116 | Confirmed by code |
| D-D-35 | 4 | Non-uuid ids and bad query values give 500: trips :id routes, /safety/trips/:id/start and complete, location history limit=abc (NaN), waitlist approve | trips.ts:98, 205; safety.ts:84, 410, 484; waitlist.ts:190 | Confirmed by code; runtime check |
| D-D-36 | 4 | Dates: pg DATE columns serialise as ISO strings; Safety card prints the raw value; Trips card may shift a day by time zone | SafetyScreen.web.tsx:377; TripsScreen.web.tsx:55-57; utils/db.ts (no type parser) | Needs runtime check |
| D-D-37 | 4 | End date before start date accepted (UI and API) | TripsScreen.web.tsx:270-283; trips.ts:22-23 | Confirmed by code |
| D-D-38 | 4 | requires_input status has no label ("Unknown") | SafetyScreen.web.tsx:245-246 | Confirmed by code |
| D-D-39 | 4 | Admin approve: invite link never shown for the row just approved (list reloads and it leaves the Waiting tab); error banner never cleared | AdminWaitlist.web.tsx:44-45, 79, 95 | Confirmed by code |
| D-D-40 | 4 | Voice router comment refers to routes/elevenlabsVoice.ts which does not exist; no settings UI, only env vars | requireWebhookSecret.ts:9; routes directory listing | Confirmed by code |
| D-D-41 | 4 | start and complete UPDATE ... FROM travelers with no join condition (needless cross join; 404 if travelers were empty) | safety.ts:404-410, 481-485 | Confirmed by code |
| D-D-42 | 4 | Dashboard status changes swallow errors (console.error only) | DashboardScreen.web.tsx:34-41 | Confirmed by code |

## 5. Coverage summary

Test cases: TRP 22, WHO 11, TM 11, SAF 3, CHK 13, LOC 6, SOS 10, CON 10, RPT 6, EMG 2, VER 3, VOI 8, DSH 16, BKG 3, REV 3, WLP 12, ADM 14, ROL 8, MOB 7. Every control in section 1 is exercised by at least one case; controls with no UI are covered by API cases or gap checks (D-TRP-19, D-TRP-20, D-CON-07, D-EMG-01, D-VOI-*, D-DSH-13 to 15, D-ADM-12).
