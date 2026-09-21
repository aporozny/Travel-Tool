# Drift test plan, Area A: auth, landing, onboarding, profile, app shell, session

Scope: `web/src/App.web.tsx`, `index.web.tsx`, `screens/{AppShell,Landing,Login,Onboarding,Profile,UnderConstruction}.web.tsx`, `hooks/*`, `store/*`, `services/api.web.ts`, `components/TripModeToggle.web.tsx` (uses the hook), and backend `routes/{auth,profile,travelers}.ts`, `middleware/{authenticate,rateLimit}.ts`, plus the small routes those screens call (`waitlist.ts`, `health.ts`, `discover.ts`, `community.ts` GET /posts, `members.ts` GET /my/connections, `messages.ts` GET /unread/count, `safety.ts` trip-mode).

Method: read-only code reading over SSH (repo `/home/andre/projects/drift`), nginx site config, deployed `web/dist` bundle strings, and the deployed `traveller-backend` container `dist/` (grep only). No live API calls and no browser clicks were made.

Evidence labels: **CODE** = confirmed by reading code on both sides. **RUNTIME** = code path is real but timing, rendering or deployed data must be observed.

Environment facts verified: production container env has `FRONTEND_URL=https://drifttravel.app`, `APP_URL=https://drifttravel.app`, SendGrid key present. (`backend/.env` on disk is stale and differs, but the container overrides it, so the reset email link should be correct; test A-063 confirms it.) nginx (`/etc/nginx/sites-available/drift`) serves `web/dist`, proxies `/api/` and `/health/` to :5001, and falls back to `/index.html` for unknown paths, so `/invite/<token>` and `/reset-password?token=` load the SPA. `web/dist` contains only `index.html` and one bundle (no `admin.html`). Backend mounts: `/api/v1/auth` (authRateLimit), `/travelers`, `/profile`, `/waitlist`, `/members`, `/messages`, `/community`, `/discover`, `/safety`; `trust proxy` = 1; JSON body limit 10kb (`backend/src/index.ts:43-75`).

Test data conventions used below:
- **TRAV-NEW**: fresh email `qa+a<N>@example.com`, password `Drift-Test-2026!` (not on the common list, does not contain the email).
- **TRAV-DONE**: traveller who finished onboarding. **TRAV-FRESH**: traveller with `onboarding_completed=false`.
- **OP**: operator account. **ADMIN**: role `admin` account.
- Rate-limit warning: register is limited to 5 attempts per hour per IP counting every attempt (`rateLimit.ts:98-104`); failed calls on `/api/v1/auth/*` are limited to 10 per 15 min per IP (`rateLimit.ts:83-90`). Batch the register tests and rotate IPs, or expect 429 (A-030, A-045 test that on purpose, run them last).

---

## 1. Screen and control inventory

Numbering (C-nn) is referenced from the test cases. Line numbers are in the file named in the group heading.

### 1.1 App gate (`web/src/App.web.tsx`, `index.web.tsx`)

| # | Control | File:line | Does what | API call |
|---|---|---|---|---|
| C-01 | Admin path gate | App.web.tsx:10-15, 39 | If `pathname` starts with `/admin` render AdminWaitlist regardless of login | none (AdminWaitlist calls GET /admin/waitlist) |
| C-02 | Auth gate | App.web.tsx:40 | `!isAuthenticated` renders LoginScreen | none |
| C-03 | Onboarding status check | App.web.tsx:24-37 | Only when `isAuthenticated` and `user.role==='traveler'`; sets `onboardingDone` from `onboarding_completed===true`; on error sets done=true (fail open) | GET /travelers/me/onboarding-status, reads `onboarding_completed` |
| C-04 | "Loading..." screen | App.web.tsx:41 | Shown while `checking` | none |
| C-05 | Onboarding gate | App.web.tsx:42 | `!onboardingDone` renders OnboardingScreen, `onComplete` sets done | none |
| C-06 | React root | index.web.tsx:11-15 | StrictMode plus redux Provider; no ErrorBoundary anywhere in web/src | none |

### 1.2 Landing (`LandingScreen.web.tsx`)

| # | Control | File:line | Does what | API call |
|---|---|---|---|---|
| C-10 | Nav "Sign in" | :88 | `onLogin` sets Login mode `login` | none |
| C-11 | Nav "Join free" | :89 | `onJoin` sets mode `register` | none |
| C-12 | Hero "Join the community" | :106 | `onJoin` | none |
| C-13 | Hero "Already a member" | :107 | `onLogin` | none |
| C-14 | Operator CTA "List your business" | :247 | `onJoin` (register, role stays default traveller) | none |
| C-15 | Final CTA "Get started" | :271 | `onJoin` | none |
| C-16 | Stats load | :63-71 | Fills eyebrow, "Operators listed", "Regions covered" | GET /health/stats, reads members, operators, places, regions |
| C-17 | Live destinations load | :74-77 | Renders destination cards (not clickable) if list non-empty | GET /api/v1/discover/destinations, reads `featured[].region,country` |
| C-18 | Static sections, footer | :133-282 | Text only; no footer links | none |

### 1.3 Login screen and its modes (`LoginScreen.web.tsx`)

| # | Control | File:line | Does what | API call |
|---|---|---|---|---|
| C-20 | Invite URL effect | :28-52 | If path matches `/invite/<token>` validate; valid: prefill email/name, mode `register`; else error and mode `login` | GET /waitlist/invite/:token, reads valid, email, name, message |
| C-21 | Reset URL effect | :57-68 | If path is exactly `/reset-password` read `?token=`; mode `reset-password`, or error plus `login` if missing | none |
| C-22 | Login email input | :379-382 | Enter key submits; autofocus | none |
| C-23 | Login password input | :387-390 | Enter key submits | none |
| C-24 | "Sign in" button | :393-396, handler :70-81 | Requires both fields; dispatch login | POST /auth/login {email, password}; reads user, accessToken, refreshToken |
| C-25 | Login "Back" | :371 | mode `landing` | none |
| C-26 | "Forgot password?" | :399 | mode `forgot-password`, clears error | none |
| C-27 | "Join the waitlist" | :404 | mode `waitlist` | none |
| C-28 | Waitlist "Back" | :160 | mode `landing` | none |
| C-29 | Waitlist name input | :180-182 | text, autofocus, no Enter handler | none |
| C-30 | Waitlist email input | :187-190 | Enter submits | none |
| C-31 | Waitlist destination input | :195-198 | Enter submits | none |
| C-32 | "Join the waitlist" submit | :201-204, :102-114 | Requires email; shows success card | POST /waitlist {email, name?, destination?, source:'direct'} |
| C-33 | Waitlist "Create your account" | :207 | mode `register` | none |
| C-34 | Waitlist "Sign in" | :210 | mode `login` | none |
| C-35 | Waitlist success "Back to home" | :168 | mode `landing` | none |
| C-36 | Register "Back" | :224 | mode `landing` | none |
| C-37 | Register email input | :241-244 | Disabled when an invite email was prefilled; no Enter handler | none |
| C-38 | Register password input | :249-252 | Enter submits; placeholder "Min 8 characters" | none |
| C-39 | Role "Traveller" button | :258 | role=traveler (default) | none |
| C-40 | Role "Operator" button | :260 | role=operator | none |
| C-41 | Terms checkbox | :266-268 | `acceptedTerms` | none |
| C-42 | "Terms of Service" link | :271 | New tab `/legal/privacy-terms.html#t-accept` | static file (nginx alias /var/www/drift/legal) |
| C-43 | "Privacy Policy" link | :273 | New tab `/legal/privacy-terms.html#p-intro` | static file |
| C-44 | "Create account" | :277-280, handler :83-100 | Client checks: both fields, length 8, terms; then register; then use-invite if invite | POST /auth/register {email, password, role, acceptedTerms}; POST /waitlist/use-invite {token} (route missing) |
| C-45 | Register "Sign in" link | :283 | mode `login` (does not clear error) | none |
| C-46 | Forgot "Back to sign in" | :295 | mode `login`, clears error and sent flag | none |
| C-47 | Forgot email input | :310-313 | Enter submits | none |
| C-48 | "Send reset link" | :315-318, :116-128 | Requires email; shows "Check your email" | POST /auth/forgot-password {email} |
| C-49 | Forgot success "Back to sign in" | :303 | mode `login` | none |
| C-50 | Reset new password | :345-347 | no Enter handler | none |
| C-51 | Reset confirm password | :351-354 | Enter submits | none |
| C-52 | "Update password" | :356-359, :130-144 | Both filled, equal, length 8; shows "Password updated" | POST /auth/reset-password {token, password} |
| C-53 | Reset success "Sign in" | :338 | mode `login`, clears fields (URL still `/reset-password?token=`) | none |

### 1.4 Onboarding (`OnboardingScreen.web.tsx`)

Only steps 1 and 2 are reachable (`REQUIRED_STEPS = 2`, :522; completion at :547-556). Steps 3 to 9 exist but the flow finishes at step 2.

| # | Control | File:line | Does what | API call |
|---|---|---|---|---|
| C-60 | Progress bar and "n of 2" | :23-32, :569 | Shows step 1 or 2 of 2 | none |
| C-61 | Header text "Travel Tool" | :568 | Static (wrong brand) | none |
| C-62 | Step 1 "I travel as" cards (6, multi-select) | :60-63 | Toggle `travel_style`: solo, couple, family_with_kids, group_of_friends, digital_nomad, honeymoon | none |
| C-63 | Step 1 "My travel pace" (4, single, re-click clears) | :69-71 | `travel_pace`: packed, balanced, slow, spontaneous | none |
| C-64 | Step 1 "Travel experience" (4, single) | :78-80 | `sea_experience_level`: first_time, been_once_or_twice, seasoned, expat | none |
| C-65 | Step 1 "Continue" | :84 | `handleNext(data)`; not disabled while saving | PATCH /travelers/me/preferences {travel_style, travel_pace, social_preference:'', sea_experience_level, work_situation:'', onboarding_step:1} |
| C-66 | Step 2 "Overall daily budget" (5, single) | :101-103 | `budget_range`: budget, mid, upper_mid, luxury, ultra_luxury | none |
| C-67 | Step 2 "Accommodation budget per night" (5) | :110-112 | `accommodation_budget_aud`: under_30, 30_to_80, 80_to_200, 200_to_500, 500_plus | none |
| C-68 | Step 2 "I'll happily splurge on" (6, multi) | :119-121 | `splurge_categories` | none |
| C-69 | Step 2 "Sustainability and spending" (3) | :128-130 | `eco_spend_willingness` | none |
| C-70 | Step 2 "Back" | :135, :561 | `currentStep-1`; Step 1 remounts with empty state | none |
| C-71 | Step 2 "Continue" (completes) | :136, :546-556 | Saves with `onboarding_completed:true`, then `onComplete` | PATCH /travelers/me/preferences {budget_range, accommodation_budget_aud, splurge_categories, eco_spend_willingness, onboarding_completed:true, onboarding_step:2} |
| C-72 | Error banner "Could not save. Please try again." | :573 | Rendered at top of body | none |
| C-73 | "Saving..." banner | :574 | Top of body | none |
| C-74 | Steps 3-9 controls (about 90 option cards, Back, Continue, "Complete profile") | :142-514 | Unreachable in the current flow (dead code); only reachable by the double-click bug D-A-5 | PATCH /travelers/me/preferences with whitelisted fields |

### 1.5 App shell (`AppShell.web.tsx`)

| # | Control | File:line | Does what | API call |
|---|---|---|---|---|
| C-80 | Default tab | :41 | operator: `dashboard`, everyone else: `explore`; depends on `user` | none |
| C-81 | Badge polling | :48-63 | Traveller only (`user.role==='traveler'`), immediately and every 15 s | GET /members/my/connections (reads direction, status), GET /messages/unread/count (reads count) |
| C-82 | Traveller nav (10): Feed, Explore, Trips, Flights, Stays, Members(badge), Messages(badge), Bookings, Safety, Profile | :74-85, :146-166 | `setTab`, clears `detail`, closes drawer | none |
| C-83 | Operator nav (3): Dashboard, Bookings, Profile | :68-73 | same | none |
| C-84 | Nav badge (red number) | :162-164 | Shown when count > 0 | none |
| C-85 | Admin button (only role admin) | :167-172 | `window.open('/admin.html','_blank')` | GET /admin.html (404, not in dist) |
| C-86 | Mobile hamburger | :108-114 | Toggle drawer (viewport under 768) | none |
| C-87 | Drawer backdrop | :124 | Closes drawer | none |
| C-88 | User info block | :177-185 | Initial, role, email | none |
| C-89 | "Sign out" | :186 | `dispatch(logout())` clears tokens locally only | none (POST /auth/logout is never called) |
| C-90 | Content router (11 tabs) | :87-102 | Local `switch(tab)`; no URL routing | none |
| C-91 | `useIsMobile` | hooks/useIsMobile.web.ts:5-16 | width under 768, updates on resize | none |

### 1.6 Profile (`ProfileScreen.web.tsx`)

| # | Control | File:line | Does what | API call |
|---|---|---|---|---|
| C-100 | Initial load | :25-36 | Loads profile and prefs together; failure only `console.error`; screen shows "Loading..." forever | GET /travelers/me (reads first_name, last_name, bio, phone, email), GET /travelers/me/preferences (reads budget_range, activity_types, travel_style) |
| C-101 | Initial load of posts | :21-23 | "My Posts" | GET /community/posts (reads id, body, region, reaction_count, comment_count, created_at) |
| C-102 | "Edit profile" / "Save changes" button | :63-65, :38-45 | Toggles edit mode; save sends PATCH; disabled while saving; no cancel | PATCH /travelers/me {first_name, last_name, bio, phone} (empty becomes undefined) |
| C-103 | First name input | :81 | disabled unless editing | none |
| C-104 | Last name input | :85 | same | none |
| C-105 | Phone input | :90 | placeholder "+61 400 000 000" | none |
| C-106 | Bio textarea | :94 | resizable | none |
| C-107 | Budget chips: Budget, Mid, Luxury | :104-109, :47-52 | optimistic state, then save | PUT /travelers/me/preferences {...allPrefs, budget_range} (route missing) |
| C-108 | Activities chips (7) | :115-119 | toggles `activity_types` | PUT /travelers/me/preferences (route missing; column absent) |
| C-109 | Travel style chips (6) | :125-129 | toggles `travel_style` | PUT /travelers/me/preferences (route missing) |
| C-110 | My Posts list and empty state | :135-160 | list or "No posts yet. Share something from the Feed tab." | none |
| C-111 | Avatar initial | :70 | first letter | none (no avatar upload UI; POST /profile/avatar unused) |

### 1.7 Trip Mode hook and toggle (`hooks/useTripMode.web.ts`, `components/TripModeToggle.web.tsx`)

| # | Control | File:line | Does what | API call |
|---|---|---|---|---|
| C-120 | Trip Mode toggle switch | TripModeToggle:27-34 | on: `enable()`; off: `disable()` | POST /safety/location/trip-mode {enabled:true/false} |
| C-121 | Location watcher | useTripMode:134-140, :110-120 | `watchPosition`, POST at most every 5 min or 250 m | POST /safety/location {latitude, longitude} |
| C-122 | Error line | TripModeToggle:36 | shows `error` text | none |

### 1.8 Session plumbing (`services/api.web.ts`, `store/authSlice.web.ts`)

| # | Control | File:line | Does what | API call |
|---|---|---|---|---|
| C-130 | Token storage | api.web.ts:288-297 | localStorage `tt_access_token`, `tt_refresh_token` | none |
| C-131 | Request interceptor | :305-309 | adds `Authorization: Bearer` | none |
| C-132 | Response interceptor (401 refresh) | :311-334 | on first 401 refresh and retry; on failure clear tokens and `location.href='/'` | POST /auth/refresh {refreshToken}; reads accessToken, refreshToken |
| C-133 | Redux initial state | authSlice:177-182 | `isAuthenticated = !!token`, `user = null` (nothing ever fills `user` on reload; `setUser` at :67 is never dispatched) | none |
| C-134 | Register / login thunks | authSlice:184-215 | store tokens, set user; on error payload = `response.data.message` or fallback | POST /auth/register, POST /auth/login (raw axios, no timeout) |
| C-135 | Logout thunk | authSlice:217-219, :261-264 | clears tokens, sets user null | none |

### 1.9 Unused or orphaned

| # | Item | File:line | Note |
|---|---|---|---|
| C-140 | UnderConstructionScreen | UnderConstructionScreen.web.tsx:21 | Not imported anywhere (grep) |
| C-141 | Redux `clearError`, `setUser`, `isLoading`, `error` | authSlice | Not used by any screen |
| C-142 | Backend POST /profile/avatar, GET /profile/me | routes/profile.ts:12, :40 | No web caller (grep); avatar base64 would also exceed the 10kb JSON limit (index.ts:49) |
| C-143 | Backend PATCH fields nationality, date_of_birth, avatar_url | travelers.ts:67-75 | No UI field |

Control count: 98 rows of interactive controls, effects and plumbing (C-01 to C-143, counting each numbered row; grouped cards in C-74 count as one).

---

## 2. API contract check

| # | UI call (file:line) | Backend route file:line | Match? | Problem |
|---|---|---|---|---|
| 1 | POST /auth/register {email, password, role, acceptedTerms} (authSlice:191) | auth.ts:62 registerSchema :25-40 | Yes for happy path | Zod failures return `{message:'Validation error', errors:[...]}` (auth.ts:113) but UI reads only `message` (authSlice:196-198), so users see "Validation error" for: bad email, password over 100 chars, "Password is too common", "Password cannot contain your email address", terms message. 409 "Email already registered" and 429 messages display correctly |
| 2 | POST /auth/login {email, password} (authSlice:207) | auth.ts:123 | Yes | Bad email format gives "Validation error" (auth.ts:152). 401 message "Invalid email or password" shown. Reads `user`, `accessToken`, `refreshToken`: all returned (auth.ts:145-149) |
| 3 | POST /auth/refresh {refreshToken} (api.web.ts:320) | auth.ts:160 | Yes | Returns `accessToken` and rotated `refreshToken`; single Redis slot `refresh:<id>` (auth.ts:143, 188): a login elsewhere or a concurrent refresh invalidates the other token |
| 4 | POST /auth/forgot-password {email} (Login:121) | auth.ts:207 | Yes | Always 200; email failures are swallowed (sendEmail returns false, auth.ts:222-228); invalid email format shows "Validation error" |
| 5 | POST /auth/reset-password {token, password} (Login:137) | auth.ts:256 | Yes | Invalid token gives 400 with specific message (shown). "Password is too common" hidden behind "Validation error". No email-contains check here (differs from register) |
| 6 | POST /auth/logout | auth.ts:282 | UI never calls | Refresh token stays valid 7 days after "Sign out" (authSlice:217-219) |
| 7 | GET /waitlist/invite/:token (Login:34) | waitlist.ts:97 | Partial | Server returns 404/409/410 with `{valid:false,message}` (waitlist.ts:108,114,118) so axios throws and UI always shows the generic "This invite link is invalid or has expired." (Login:47-50); `r.data.valid===false` branch (Login:42-45) is unreachable; "already used" message never shown |
| 3b | POST /waitlist/use-invite {token} (Login:93) | none (waitlist.ts has POST /, GET /check, GET /invite/:token only; deployed dist grep count 0) | NO, route missing | 404 swallowed by `.catch(()=>{})`; waitlist row never becomes `joined` (no code writes it); invite link stays reusable |
| 8 | POST /waitlist {email, name?, destination?, source:'direct'} (Login:107) | waitlist.ts:22 joinSchema :11-17 | Yes | Any zod error (for example name over 100 chars) returns "Invalid email address." (waitlist.ts:65). 409 messages shown |
| 9 | GET /health/stats (Landing:63) | health.ts:16 via nginx `/health/` | Yes | Reads members, operators, places, regions: all returned as ints |
| 10 | GET /api/v1/discover/destinations (Landing:74) | discover.ts:9 | Yes | `featured[{region,country}]` returned (discovery.ts:127-136) |
| 11 | GET /travelers/me/onboarding-status (App:31) | travelers.ts:264 | Yes | Returns `onboarding_completed`; no row gives `false`; UI treats any error as "done" |
| 12 | PATCH /travelers/me/preferences (Onboarding:533) | travelers.ts:183 | Yes | All step fields are in the whitelists (ARRAY :78-87, SCALAR :89-101, BOOL :103); values fit the VARCHAR limits (002_member_preferences.sql). Empty arrays and '' overwrite saved values (travelers.ts:203, :214) |
| 13 | GET /travelers/me (Profile:26) | travelers.ts:106 | Yes for travellers | Operators and admins have no `travelers` row (auth.ts:86-91) so 404 `{message:'Profile not found'}` and Profile sticks on "Loading..." |
| 14 | GET /travelers/me/preferences (Profile:26) | travelers.ts:161 | Partial | Returns `member_preferences.*`; there is no `activity_types` column (only in legacy `utils/schema.sql:40`), so Activities chips can never show a saved state |
| 15 | PATCH /travelers/me {first_name, last_name, bio, phone} (Profile:41) | travelers.ts:128 updateProfileSchema :67-75 | Yes | Empty fields are sent as undefined so a field cannot be cleared; all-empty sends `{}` and gets 400 "No fields to update"; phone over 20 or bio over 1000 gives 400 "Validation error"; UI shows none of these (Profile:43 only console.error) |
| 16 | PUT /travelers/me/preferences (Profile:51) | none (travelers.ts has only GET :161 and PATCH :183; deployed dist has no `.put(`) | NO, route missing | 404 from `notFound` (`Route PUT ... not found`); unhandled promise rejection; chip changes never persist. Payload also sends whole row (id, traveler_id...) and a non-existent `activity_types` |
| 17 | GET /community/posts (Profile:22) | community.ts:459 | Yes | Returns own posts (author = current user) with the fields the UI reads |
| 18 | GET /members/my/connections (AppShell:51) | members.ts:161 | Yes | Reads `direction`,`status`: returned. Inner join on member_preferences and travelers |
| 19 | GET /messages/unread/count (AppShell:56) | messages.ts:193 | Yes | `count` returned |
| 20 | POST /safety/location/trip-mode {enabled} (useTripMode:125, :151) | safety.ts:99 | Yes | No GET to read current consent, so toggle always starts OFF on reload |
| 21 | POST /safety/location {latitude, longitude} (useTripMode:119) | safety.ts:38 locationSchema :12-16 | Yes | Traveller role only (403 otherwise), consent required (403); UI ignores errors |
| 22 | window.open('/admin.html') (AppShell:168) | nginx `~* \.html$ try_files $uri =404`; `web/dist` has no admin.html; webpack `clean:true`, no copy plugin | NO | 404 page. `/admin` also redirects (301) to `/admin.html` |
| 23 | Link /legal/privacy-terms.html#t-accept and #p-intro (Login:271,273) | nginx alias /var/www/drift/legal/ | Yes | File exists; both anchors present |
| 24 | Bearer token on every request (api.web.ts:305) vs authenticate (authenticate.ts:13-50) | | Yes | Role is read from the DB not the JWT; 401 `Invalid or expired token`, `Account not found or deactivated`; DB hit on every request (comment at :33 says every 5 min) |
| 25 | Role checks: routes vs UI | travelers.ts and profile.ts require only authenticate | Gap | Operators/admins can call traveller routes and get 404; UI shows the Profile tab to operators (AppShell:72) |

---

## 3. Test cases

Priority: P1 must work, P2 should, P3 nice. Type: UI, API, Validation, Edge, Mobile, Security. "Mobile" means viewport 375x812 unless stated. Steps are literal clicks and inputs.

### 3.1 Landing page

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-001 | Landing | Logged out, clean localStorage | 1) Open https://drifttravel.app/ | Landing renders: nav (Drift, Sign in, Join free), hero, stats, problem, value props, how it works, operator CTA, final CTA, footer; no console errors | P1 | UI | Login:146-153, Landing:80 |
| A-002 | Landing | Same | 1) Click nav "Sign in" | Login form shows (title "Travel with better people.", email focused) | P1 | UI | Landing:88, Login:368 |
| A-003 | Landing | Same | 1) Click nav "Join free" | Register form ("Create your account"), role Traveller active, terms unchecked | P1 | UI | Landing:89, Login:220 |
| A-004 | Landing | Same | 1) Click hero "Join the community" | Register form | P1 | UI | Landing:106 |
| A-005 | Landing | Same | 1) Click hero "Already a member" | Login form | P1 | UI | Landing:107 |
| A-006 | Landing | Same | 1) Scroll to "Are you an operator?" 2) Click "List your business" | Register form. Check whether Operator is preselected (currently it is NOT, Traveller stays active: report as defect D-A-19) | P2 | UI | Landing:247, Login:16 |
| A-007 | Landing | Same | 1) Click final "Get started" | Register form | P2 | UI | Landing:271 |
| A-008 | Landing | DevTools network open | 1) Load `/` | GET /health/stats 200 and GET /api/v1/discover/destinations 200; eyebrow shows "Live in N destinations worldwide"; "Operators listed" is a number, not NaN | P1 | API | Landing:63-77 |
| A-009 | Landing | Block /health/stats and the destinations call | 1) Load `/` | Page still renders; stats show dashes; eyebrow "Now open worldwide"; no destinations section; no crash | P2 | Edge | Landing:71, 77, 214 |
| A-010 | Landing | Backend returns regions of 0 or 1 | 1) Load `/` | Eyebrow reads "Live in Bali destinations worldwide" (awkward fallback, see D-A-25) | P3 | Edge | Landing:69, 98 |
| A-011 | Landing | Mobile 375px | 1) Load `/` 2) Scroll top to bottom 3) Tap every CTA | No horizontal scroll, hero wraps, all six CTAs tappable, nav buttons visible | P1 | Mobile | Landing:45-54, 95 |
| A-012 | Landing | Any | 1) Resize from 1200 to 700 to 1200 px | Layout switches at 768 without reload; no stuck styles | P3 | UI | useIsMobile:10-14 |
| A-013 | Landing | Any | 1) On Login "Back" from login, register, waitlist | Returns to landing each time | P2 | UI | Login:160, 224, 371 |
| A-014 | Landing | Any | 1) Tab through the page with keyboard 2) Press Enter on focused CTA | CTAs reachable and activate by keyboard | P3 | UI | Landing (buttons) |

### 3.2 Sign-up (traveller and operator)

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-015 | Register | TRAV-NEW | 1) Landing, "Join free" 2) Email `qa+a1@example.com` 3) Password `Drift-Test-2026!` 4) Tick terms 5) Click "Create account" | Button shows "Creating account..." then user lands in Onboarding step 1 (not the app); localStorage has both tokens; DB row users(role traveler) and travelers row; consent recorded | P1 | UI | Login:83-100, auth.ts:62-109 |
| A-016 | Register | OP data | 1) Register form 2) Click "Operator" (turns gold) 3) Email/password 4) Tick terms 5) Create account | Account created with role operator, NO onboarding, AppShell opens on Dashboard with 3 nav items (Dashboard, Bookings, Profile) | P1 | UI | Login:260, App:25, AppShell:41,68 |
| A-017 | Register | Fields empty | 1) Click "Create account" | Error "Please enter your email and password"; no network call | P1 | Validation | Login:84 |
| A-018 | Register | Email only | 1) Type email 2) Create account | Same error "Please enter your email and password" | P2 | Validation | Login:84 |
| A-019 | Register | Password `short1` | 1) Fill valid email, `short1`, tick terms 2) Create | Error "Password must be at least 8 characters"; no call | P1 | Validation | Login:85 |
| A-020 | Register | Terms unchecked | 1) Valid email and password 2) Leave terms unticked 3) Create | Error "Please accept the Terms of Service and Privacy Policy"; no call | P1 | Validation | Login:86 |
| A-021 | Register | Tick then untick terms | 1) Tick 2) Untick 3) Create | Same error as A-020 | P2 | Validation | Login:266 |
| A-022 | Register | Email `notanemail` | 1) Enter `notanemail`, valid password, terms 2) Create | Request is sent (no client email check) and server returns 400; UI shows only "Validation error" (defect D-A-6; expected better: "Enter a valid email") | P1 | Validation | auth.ts:26, 113, authSlice:196 |
| A-023 | Register | Password `password123` | 1) Valid email, password `password123`, terms 2) Create | Server 400 "Password is too common" but UI shows only "Validation error" (D-A-6) | P1 | Validation | auth.ts:20-36 |
| A-024 | Register | Password contains email | 1) Email `abcdefgh@example.com`, password `abcdefgh@example.com` 2) Create | 400; UI shows only "Validation error" (D-A-6) | P2 | Validation | auth.ts:37-39 |
| A-025 | Register | Password 101 chars | 1) Enter 101 chars 2) Create | 400 (max 100); UI shows "Validation error" | P3 | Validation | auth.ts:27 |
| A-026 | Register | Existing email | 1) Register with an existing email | Red banner "Email already registered" (409) | P1 | Validation | auth.ts:75, authSlice:196 |
| A-027 | Register | Email `QA+A1@Example.COM` uppercase | 1) Register 2) Log in with lowercase | Email lowercased server side; login works with either case | P2 | Edge | auth.ts:26, 43 |
| A-028 | Register | Any | 1) Fill valid data 2) Double-click "Create account" quickly | Exactly one account; button disabled while loading; no second 409 banner after success | P1 | Edge | Login:278 (disabled), auth.ts:62 |
| A-029 | Register | Any | 1) Fill valid data 2) In field "Password" press Enter | Submit triggers (same as button); Enter in the email field does nothing | P2 | UI | Login:251, 241 |
| A-030 | Register | Same IP, 6th attempt within an hour | 1) Submit register 6 times (any outcome) | 6th returns 429; banner "Too many accounts created from this network. Try again later." | P2 | Security | rateLimit.ts:98-104 |
| A-031 | Register | Any | 1) Click "Terms of Service" link | Opens a new tab at /legal/privacy-terms.html scrolled to `t-accept`; register form state unchanged | P1 | UI | Login:271 |
| A-032 | Register | Any | 1) Click "Privacy Policy" link | New tab at `#p-intro` | P1 | UI | Login:273 |
| A-033 | Register | Any | 1) Click the label text (not the link) "I agree to Drift's" | Checkbox toggles (label wraps input) | P3 | UI | Login:265 |
| A-034 | Register | Error showing | 1) Trigger any error 2) Click "Sign in" link at the bottom | Login form opens; the old error is still displayed (stale error, D-A-22) | P3 | Edge | Login:283 |
| A-035 | Register | Any | 1) Click Traveller then Operator then Traveller | Active style follows; last click wins; submitted role matches | P2 | UI | Login:258-261 |
| A-036 | Register | Backend down (block /api) | 1) Submit valid form | Banner "Registration failed" (no response) and button returns to normal | P2 | Edge | authSlice:196-198 |
| A-037 | Register | Mobile 375px | 1) Open register 2) Fill using on-screen keyboard 3) Scroll to submit | Card fits, no horizontal scroll, checkbox and links tappable, error banner visible | P1 | Mobile | Login:412-413 |
| A-038 | Register | Any | 1) Fill valid data 2) Click "Back" | Landing; then "Join free" again: previously typed email and password are still in the fields (state kept) | P3 | Edge | Login:11-19, 224 |
| A-039 | Register | Operator registered | 1) After A-016 refresh the page (F5) | See defect D-A-1: user becomes null, nav shows TRAVELLER tabs and lands on Explore instead of Dashboard. Expected (fixed behaviour): stays on Dashboard | P1 | Edge | authSlice:177-182, AppShell:41 |
| A-040 | Register | Traveller registered | 1) Register 2) Watch the first second after submit | Note the AppShell (Explore) flashes before Onboarding appears (D-A-14) | P3 | UI | App:21-28, 41-42 |

### 3.3 Login and logout

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-041 | Login | TRAV-DONE | 1) Landing, "Sign in" 2) Enter email and password 3) Click "Sign in" | "Signing in..." then AppShell, tab Explore, sidebar 10 items, footer shows role and email, initial in avatar | P1 | UI | Login:70-81 |
| A-042 | Login | TRAV-DONE | 1) Sign in using Enter in the password field | Same as A-041 | P1 | UI | Login:389 |
| A-043 | Login | TRAV-DONE | 1) Sign in using Enter in the email field | Submits (empty password gives error) | P2 | UI | Login:381 |
| A-044 | Login | OP | 1) Sign in as operator | AppShell opens on Dashboard, nav Dashboard/Bookings/Profile only, no onboarding | P1 | UI | AppShell:41, 68-73 |
| A-045 | Login | ADMIN | 1) Sign in as admin | Traveller nav plus "Admin" item with gear icon; lands on Explore; no onboarding check | P1 | UI | AppShell:66, 167-172 |
| A-046 | Login | TRAV-FRESH | 1) Sign in | Onboarding step 1 (may flash AppShell first, D-A-14) | P1 | UI | App:31-42 |
| A-047 | Login | Empty fields | 1) Click "Sign in" | "Please enter your email and password"; no call | P1 | Validation | Login:71 |
| A-048 | Login | Wrong password | 1) Enter valid email and wrong password 2) Sign in | "Invalid email or password"; button re-enabled; fields keep values | P1 | Validation | auth.ts:138 |
| A-049 | Login | Unknown email | 1) Sign in with unregistered email | Same message "Invalid email or password" (no user enumeration by text) | P1 | Security | auth.ts:137-139 |
| A-050 | Login | Invalid email format `abc` | 1) Sign in | 400, UI shows "Validation error" (D-A-6) | P2 | Validation | auth.ts:152 |
| A-051 | Login | Deactivated user (`is_active=false`) | 1) Sign in | "Invalid email or password" | P2 | Security | auth.ts:128 |
| A-052 | Login | Any | 1) Fail login 10 times within 15 min from one IP | 11th shows "Too many attempts. Try again in 15 minutes." (429); further valid logins also blocked until window ends; successful logins are not counted | P2 | Security | rateLimit.ts:83-90, index.ts:57 |
| A-053 | Login | Any | 1) Double-click "Sign in" | One request in flight; no duplicate state | P2 | Edge | Login:394 |
| A-054 | Login | Any | 1) Click "Back" | Landing | P2 | UI | Login:371 |
| A-055 | Login | Response time | 1) Time 20 logins for a registered email vs 20 for an unknown email | Times should be similar; unknown-email is likely much faster because the dummy hash is not a valid bcrypt hash (D-A-26) | P3 | Security | auth.ts:133-135 |

### 3.4 Logout and session persistence

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-056 | Logout | TRAV-DONE logged in | 1) Click "Sign out" in the sidebar footer | Both localStorage tokens removed; Landing page shows; Back button does not restore app | P1 | UI | AppShell:186, authSlice:217-219 |
| A-057 | Logout | Same, after A-056 | 1) Copy the refresh token before logging out 2) After logout POST /auth/refresh with it via API client | Currently returns 200 with new tokens because logout never calls /auth/logout (D-A-8); expected 401 | P1 | Security | authSlice:217, auth.ts:282-301 |
| A-058 | Logout | Two tabs logged in | 1) In tab A click Sign out 2) In tab B click any nav item that loads data | Tab B API call gets 401, refresh fails, page reloads to `/`; no infinite reload loop | P2 | Edge | api.web.ts:315-330 |
| A-059 | Logout | Logged in | 1) Sign out 2) Sign in as a different user (operator) in the same tab without reload | Operator UI shown, not the previous user's data; no flash of the traveller's onboarding-done state (D-A-14) | P2 | Edge | App:21-37 |
| A-060 | Session | Logged in as OP | 1) Press F5 | Expected stays operator; actual (D-A-1): traveller nav, Explore tab, badges do not poll | P1 | Edge | authSlice:177-182 |
| A-061 | Session | Logged in as TRAV-DONE | 1) Press F5 | Stays logged in (token in localStorage); lands on Explore (tab is not remembered, D-A-7) but nav badges do NOT show until user object exists (D-A-1) | P1 | Edge | AppShell:49 |
| A-062 | Session | Logged in as ADMIN | 1) F5 | "Admin" nav item disappears (user null) even though still admin | P1 | Edge | AppShell:66, 167 |
| A-063 | Session | localStorage keys removed manually while page open | 1) Delete `tt_access_token` in DevTools 2) Click a nav item that fetches | Request goes without Authorization, gets 401, no refresh token, tokens cleared, redirect to `/`, Login/Landing shows | P2 | Edge | api.web.ts:318-330 |
| A-064 | Session | Storage blocked (private mode with storage disabled) | 1) Open site | Module load calls `localStorage.getItem` (authSlice:179); check it does not white-screen | P3 | Edge | authSlice:179 |

### 3.5 Forgot and reset password

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-065 | Forgot | Registered TRAV-DONE | 1) Login form, click "Forgot password?" 2) Email field is focused 3) Type email 4) Click "Send reset link" | "Sending..." then "Check your email" card with 1 hour text; email arrives from safety@drifttravel.app with link `https://drifttravel.app/reset-password?token=<64 hex>` | P1 | UI | Login:116-128, auth.ts:207-231 |
| A-066 | Forgot | Unregistered email | 1) Same flow | Identical success card (no enumeration); no email sent | P1 | Security | auth.ts:216, 231 |
| A-067 | Forgot | Empty email | 1) Click "Send reset link" | "Please enter your email address" | P1 | Validation | Login:117 |
| A-068 | Forgot | Email `abc` | 1) Send | Server 400, UI "Validation error" | P3 | Validation | auth.ts:234 |
| A-069 | Forgot | Any | 1) Type email 2) Press Enter | Submits | P2 | UI | Login:312 |
| A-070 | Forgot | Any | 1) Click "Back to sign in" (top) 2) Re-open forgot | Login form; forgot form resets (sent flag cleared) | P2 | UI | Login:295 |
| A-071 | Forgot | After success card | 1) Click "Back to sign in" (in the card) | Login form | P2 | UI | Login:303 |
| A-072 | Forgot | Email delivery | 1) Request reset 2) Check inbox, spam | Email arrives within a minute; link host is drifttravel.app (container env is correct; `backend/.env` on disk is stale) | P1 | Edge | auth.ts:221 |
| A-073 | Reset | Valid token from email | 1) Open the link 2) Observe first paint | Landing may flash for one frame, then "Choose a new password" (D-A-23) | P2 | UI | Login:10, 57-68 |
| A-074 | Reset | Valid token | 1) New password `New-Pass-2026!` 2) Confirm same 3) Click "Update password" | "Updating..." then "Password updated" card | P1 | UI | Login:130-144, auth.ts:256-279 |
| A-075 | Reset | After A-074 | 1) Click "Sign in" on the success card 2) Log in with the new password | Login succeeds; old password fails with "Invalid email or password"; old refresh session invalidated (other device logged out at next refresh) | P1 | Security | Login:338, auth.ts:268-269 |
| A-076 | Reset | Valid token | 1) Leave both fields empty 2) Update | "Please fill in both password fields" | P1 | Validation | Login:131 |
| A-077 | Reset | Valid token | 1) `Password-One1` and `Password-Two2` 2) Update | "Passwords do not match" | P1 | Validation | Login:132 |
| A-078 | Reset | Valid token | 1) `short1` in both 2) Update | "Password must be at least 8 characters" | P1 | Validation | Login:133 |
| A-079 | Reset | Valid token | 1) `password123` in both 2) Update | Server 400; UI shows only "Validation error" instead of "Password is too common" (D-A-6) | P2 | Validation | auth.ts:246-248 |
| A-080 | Reset | Used token (re-open the link after A-074) | 1) Open link 2) Set password | Banner "This reset link is invalid or has expired. Request a new one." | P1 | Validation | auth.ts:261-263 |
| A-081 | Reset | Link `/reset-password` without token | 1) Open `/reset-password` | Login form with banner "This reset link is missing its token." | P2 | Edge | Login:63-65 |
| A-082 | Reset | Link `/reset-password/` (trailing slash) or `?token=` empty | 1) Open | Trailing slash: landing page (exact match fails); empty token: "missing its token" banner | P3 | Edge | Login:58 |
| A-083 | Reset | Token expired (wait over 1 hour or delete key) | 1) Open link 2) Submit | Same message as A-080 | P2 | Edge | auth.ts:219, 261 |
| A-084 | Reset | After success | 1) Refresh the page (URL still `/reset-password?token=...`) | Reset form appears again with a dead token; submit gives the invalid-link message (D-A-23) | P3 | Edge | Login:338 |
| A-085 | Reset | Logged in already (token in storage) | 1) Open the reset link | AppShell shows instead of the reset form (LoginScreen not mounted) | P3 | Edge | App:40 |
| A-086 | Reset | Mobile 375px | 1) Complete A-074 on a phone | Fields visible with keyboard open, no layout break | P2 | Mobile | Login:411-413 |
| A-087 | Reset | Any | 1) Type new password 2) Press Enter | Nothing happens (no Enter handler on first field); Enter on confirm submits | P3 | UI | Login:345-354 |

### 3.6 Waitlist and invite

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-088 | Waitlist | Logged out | 1) Login form, click "Join the waitlist" | Waitlist form: name (focused), email, destination, copy says "invite-only" (contradicts open sign-up, D-A-19) | P2 | UI | Login:156-176, 404 |
| A-089 | Waitlist | New email | 1) Name `Sam` 2) Email 3) Destination `Bali` 4) Click "Join the waitlist" | "Joining..." then "You're on the list." card; row created with source `direct` | P1 | UI | Login:102-114, waitlist.ts:22-73 |
| A-090 | Waitlist | Same email again | 1) Submit again | Banner "You are already on the waitlist. We will be in touch." | P1 | Validation | waitlist.ts:37 |
| A-091 | Waitlist | Email of an existing user | 1) Submit | "An account with this email already exists. Sign in instead." | P2 | Validation | waitlist.ts:47-49 |
| A-092 | Waitlist | Empty email | 1) Submit | "Please enter your email address" | P1 | Validation | Login:103 |
| A-093 | Waitlist | Email `abc` | 1) Submit | 400 "Invalid email address." | P2 | Validation | waitlist.ts:65 |
| A-094 | Waitlist | Name of 101 chars | 1) Submit with valid email | 400 shows the misleading "Invalid email address." (D-A-28) | P3 | Validation | waitlist.ts:12, 65 |
| A-095 | Waitlist | Any | 1) In destination field press Enter | Submits; Enter in name field does nothing | P3 | UI | Login:189, 197 |
| A-096 | Waitlist | Any | 1) Use each link: "Create your account", "Sign in", "Back", "Back to home" after success | register, login, landing, landing respectively | P2 | UI | Login:160, 168, 207, 210 |
| A-097 | Invite | Admin approved an entry (valid token, unexpired) | 1) Open `/invite/<token>` logged out | Brief landing, then register form with green "Invite accepted" banner, email prefilled and disabled, name state filled | P1 | UI | Login:28-41, 228-232 |
| A-098 | Invite | Same | 1) Complete registration with invite | Account created; POST /waitlist/use-invite returns 404 silently (D-A-9); waitlist row stays `invited`; reopening the invite link still works | P1 | API | Login:92-94 |
| A-099 | Invite | Unknown token | 1) Open `/invite/abc` | Login form with banner "This invite link is invalid or has expired." | P1 | Validation | Login:47-50 |
| A-100 | Invite | Expired token (over 7 days) | 1) Open link | Server sends 410 with a specific message, UI shows the generic one (D-A-10) | P2 | Validation | waitlist.ts:117-119 |
| A-101 | Invite | Token whose row is `joined` | 1) Open link | Server 409 "already used", UI generic (D-A-10). Note nothing ever sets `joined` (D-A-9) | P3 | Validation | waitlist.ts:113-115 |
| A-102 | Invite | Path `/invite/` with disallowed chars, e.g. `/invite/a_b` | 1) Open | Regex `[a-zA-Z0-9-]+` matches `a` only; token `a` is validated and fails | P3 | Edge | Login:30 |

### 3.7 Token refresh, expiry and errors

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-103 | Token | Logged in, access token expired (wait 15 min or edit exp), valid refresh token | 1) Click a nav item that fetches (Trips) | One POST /auth/refresh, both tokens replaced in localStorage, the original request retried and succeeds, no visible error | P1 | API | api.web.ts:311-330, auth.ts:160-194 |
| A-104 | Token | Access token expired and AppShell polling running | 1) Leave the app open on Explore for over 15 min 2) Watch network | The two poll calls (connections and unread) hit 401 at the same moment; verify only one logout-free refresh sequence and that you are NOT kicked out (race, D-A-12) | P1 | Edge | AppShell:50-61, api.web.ts:315-330 |
| A-105 | Token | Refresh token expired or deleted in Redis | 1) Trigger any API call | Refresh 401, tokens cleared, redirect to `/`, Landing shown | P1 | Edge | api.web.ts:327-330 |
| A-106 | Token | Same account signed in on two browsers | 1) Log in on browser A 2) Log in on browser B 3) Wait for A's access token to expire and act in A | A is logged out (single Redis slot, D-A-12) | P2 | Security | auth.ts:143 |
| A-107 | Token | Tampered access token | 1) Edit one char of `tt_access_token` 2) Reload and navigate | 401, refresh with valid refresh token succeeds, works | P2 | Security | authenticate.ts:47-49 |
| A-108 | Token | Both tokens garbage | 1) Set both to `x` 2) Reload | AppShell paints briefly, first API call fails, redirect to `/`, Login; no reload loop | P2 | Edge | authSlice:179, api.web.ts:328 |
| A-109 | Token | User deactivated in DB while logged in | 1) Deactivate 2) Click any nav item | 401 "Account not found or deactivated", refresh fails, logged out | P2 | Security | authenticate.ts:41-43 |
| A-110 | Token | API returns 500 for GET /travelers/me | 1) Open Profile | Shows "Loading..." forever, no error text (D-A-16) | P2 | Edge | Profile:26-35, 57 |
| A-111 | Token | Slow network (throttle 3G, over 10 s) | 1) Open Profile or Onboarding Continue | Axios 10 s timeout: Onboarding shows "Could not save. Please try again." (banner at top of page); Profile stays "Loading..." | P2 | Edge | api.web.ts:301, Onboarding:537 |
| A-112 | Token | 429 from general limiter (over 300 requests/min) | 1) Hammer an endpoint | Screens swallow the error silently; login shows "Too many requests." | P3 | Edge | rateLimit.ts:116-122 |

### 3.8 Onboarding

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-113 | Onboarding | TRAV-FRESH | 1) Log in | Header "Travel Tool" (wrong brand, D-A-13), progress "1 of 2", step name "Who you are", title "How do you travel?", 3 sections, one "Continue" button, no Back, no Skip, no Sign out | P1 | UI | Onboarding:524-584, 568 |
| A-114 | Onboarding | Step 1 | 1) Click "Solo" 2) Click "Couple" | Both selected with check mark (multi-select) | P1 | UI | Onboarding:60-63 |
| A-115 | Onboarding | Step 1 | 1) Click "Solo" twice | Selected then deselected | P2 | UI | Onboarding:47 |
| A-116 | Onboarding | Step 1 | 1) Click "Balanced" then "Slow travel" 2) Click "Slow travel" again | Single-select: only Slow selected; second click on it clears it | P2 | UI | Onboarding:50, 69-71 |
| A-117 | Onboarding | Step 1 | 1) Click "Seasoned traveller" | Selected, single choice | P2 | UI | Onboarding:78-80 |
| A-118 | Onboarding | Step 1, nothing selected | 1) Click "Continue" | No validation: advances to step 2 with request body containing empty arrays and empty strings; PATCH 200; header "2 of 2", title "Budget & spending" | P1 | Validation | Onboarding:84, 529-558 |
| A-119 | Onboarding | Step 1 with choices | 1) Solo + Balanced + Seasoned 2) Continue | PATCH sent with travel_style ["solo"], travel_pace "balanced", sea_experience_level "seasoned", onboarding_step 1; DB member_preferences updated | P1 | API | travelers.ts:183-261 |
| A-120 | Onboarding | Step 2 | 1) Choose each option in "Overall daily budget" one at a time | Single-select, 5 options, values budget, mid, upper_mid, luxury, ultra_luxury | P2 | UI | Onboarding:101-103 |
| A-121 | Onboarding | Step 2 | 1) Choose an accommodation budget 2) Select 3 splurge items including "Nothing — strict budget" 3) Pick an eco option | Multi-select for splurge (nothing does not clear others, allowed); single for others | P2 | UI | Onboarding:110-130 |
| A-122 | Onboarding | Step 2 | 1) Click "Continue" (final) | PATCH with onboarding_completed true and onboarding_step 2; then app opens on Explore; GET onboarding-status now true; reload keeps you out of onboarding (after D-A-1 user object exists on login) | P1 | UI | Onboarding:546-556, travelers.ts:235-238 |
| A-123 | Onboarding | Step 2 | 1) Click "Back" | Step 1 shows with all cards EMPTY (state lost); resubmitting Continue overwrites saved answers with empties (D-A-11) | P1 | Edge | Onboarding:561, 45-46, travelers.ts:203-214 |
| A-124 | Onboarding | Step 1 | 1) Double-click "Continue" quickly | Expected one advance; actual risk: two `setCurrentStep` calls skip step 2 and show Step 3 with "3 of 2" progress; going on eventually reaches index 9 and crashes to a white screen (D-A-5, D-A-31) | P1 | Edge | Onboarding:84, 546-558, 516, 575 |
| A-125 | Onboarding | Step 2 | 1) Double-click "Continue" | Two PATCH calls, `onComplete` twice; app opens once, no error | P2 | Edge | Onboarding:554-555 |
| A-126 | Onboarding | Step 1, API returns 500 (block route) | 1) Click Continue | Banner "Could not save. Please try again." at the TOP of the page (off screen when Continue is at the bottom on mobile, D-A-18); stays on step 1; retry works when the API returns | P1 | Edge | Onboarding:537-541, 573 |
| A-127 | Onboarding | Step 1 | 1) F5 mid-step after selecting options | Refresh: user object null so onboarding is skipped and you land in the app (D-A-1). After signing out and in again, onboarding restarts at step 1 with nothing prefilled (`onboarding_step` is saved but not used) | P1 | Edge | App:25-27, Onboarding:525 |
| A-128 | Onboarding | Step 2 | 1) Press browser Back | Leaves Drift (no history entries) | P2 | Edge | no router (grep) |
| A-129 | Onboarding | Stuck user (API failing) | 1) Look for a way out | No "Sign out" or "Skip" control exists; the user can only close the tab | P2 | UI | Onboarding:565-583 |
| A-130 | Onboarding | onboarding-status endpoint returns 500 | 1) Log in as TRAV-FRESH | Fail open: goes straight to the app, onboarding never shown (by design, verify and record) | P2 | Edge | App:35 |
| A-131 | Onboarding | Mobile 375px | 1) Complete steps 1 and 2 by touch | Cards wrap, Continue reachable, progress bar visible, Back button not clipped | P1 | Mobile | Onboarding:601-622 |
| A-132 | Onboarding | Step 2 complete | 1) After finishing, log out and in | No onboarding on the second login; prefs visible on Profile (budget chip may not highlight for upper_mid or ultra_luxury, D-A-24) | P2 | Edge | Profile:7, 105 |
| A-133 | Onboarding | Direct API | 1) PATCH /travelers/me/preferences with `{}` | 400 "No valid preference fields provided" | P3 | API | travelers.ts:240-242 |
| A-134 | Onboarding | Direct API | 1) PATCH with `{"travel_style":"solo"}` (string not array) | Field ignored, 400 if nothing else valid | P3 | API | travelers.ts:203 |
| A-135 | Onboarding | Operator token | 1) PATCH /travelers/me/preferences as operator | 404 "Traveler profile not found" | P3 | Security | travelers.ts:192-194 |

### 3.9 App shell navigation and role visibility

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-136 | Nav desktop | TRAV-DONE, width 1280 | 1) Click each of Feed, Explore, Trips, Flights, Stays, Members, Messages, Bookings, Safety, Profile | Each renders its screen in `main`; active item has gold background and dark label; no console error | P1 | UI | AppShell:87-102, 146-166 |
| A-137 | Nav desktop | Same | 1) Click Explore result to open an operator detail 2) Click "Feed" then "Explore" | Detail is cleared on nav click | P2 | UI | AppShell:153 |
| A-138 | Nav badge | TRAV-DONE with 2 pending received connections and 3 unread messages | 1) Log in fresh (not refresh) | Members shows red "2", Messages "3"; updates within 15 s of new events | P1 | UI | AppShell:48-63, 162 |
| A-139 | Nav badge | Same | 1) Press F5 | Badges disappear and never poll because `user` is null (D-A-1) | P1 | Edge | AppShell:49 |
| A-140 | Nav badge | Zero counts | 1) Check nav | No badge element | P3 | UI | AppShell:162 |
| A-141 | Nav badge | Connections API fails | 1) Block GET /members/my/connections | No badge, no error, no crash | P3 | Edge | AppShell:55 |
| A-142 | Role | OP | 1) Log in | Nav only Dashboard, Bookings, Profile; Messages, Members, Safety, Explore absent | P1 | UI | AppShell:68-73 |
| A-143 | Role | OP | 1) Click Profile | Expect an operator profile; actual "Loading..." forever (GET /travelers/me 404, D-A-3) | P1 | Edge | Profile:26-35, travelers.ts:117-119 |
| A-144 | Role | OP | 1) Click Bookings and Dashboard | Screens load (Area covered by others); no traveller-only calls fired (badge polling skipped for operator) | P2 | UI | AppShell:49 |
| A-145 | Role | ADMIN | 1) Log in 2) Inspect sidebar | Traveller items plus "Admin" | P1 | UI | AppShell:167 |
| A-146 | Role | ADMIN | 1) Click "Admin" | New tab opens `/admin.html`: currently a 404 page (D-A-4). Expected: admin waitlist page | P1 | UI | AppShell:168, nginx |
| A-147 | Role | ADMIN | 1) Click Profile 2) Click Safety | Profile may hang if admin has no travelers row; Safety trip-mode returns 403 for non-traveller role (D-A-21). Record actual | P2 | Edge | travelers.ts:117, safety.ts:39-41 |
| A-148 | Role | Logged out | 1) Open `/admin/anything` | AdminWaitlist shell renders without login; list request 401, refresh fails and redirects to `/`; nothing sensitive leaks | P2 | Security | App:11, 39, waitlist.ts:151 |
| A-149 | Role | Logged out | 1) Open `/admin` | 301 to `/admin.html`, then 404 | P2 | Edge | nginx |
| A-150 | Role | TRAV-DONE | 1) Call GET /admin/waitlist with the traveller token | 403 "Admin access required" | P1 | Security | waitlist.ts:143-146 |
| A-151 | Mobile nav | TRAV-DONE, 375x812 | 1) Load app | Top header with hamburger, Drift logo; sidebar hidden off-screen; content fills width | P1 | Mobile | AppShell:106-136 |
| A-152 | Mobile nav | Same | 1) Tap hamburger | Drawer slides in (260px), backdrop dims | P1 | Mobile | AppShell:110, 133 |
| A-153 | Mobile nav | Drawer open | 1) Tap a nav item | Tab changes, drawer closes | P1 | Mobile | AppShell:153 |
| A-154 | Mobile nav | Drawer open | 1) Tap the backdrop | Drawer closes | P1 | Mobile | AppShell:124 |
| A-155 | Mobile nav | Drawer open | 1) Press Escape (keyboard) 2) Tap hamburger again | Escape does nothing (not implemented); hamburger toggles closed | P3 | Mobile | AppShell:110 |
| A-156 | Mobile nav | Drawer closed | 1) Tab with keyboard from the header | Hidden nav items are still focusable while off-screen (D-A-27) | P3 | Mobile | AppShell:127-136 |
| A-157 | Mobile nav | 375x667 device, address bar visible | 1) Scroll to the bottom of a long screen | The shell uses `100vh`; check the last content is not hidden under the browser toolbar | P3 | Mobile | AppShell:200 |
| A-158 | Mobile nav | Drawer open then rotate or resize to 1024 | 1) Resize | Desktop sidebar shows; no stuck backdrop | P3 | Mobile | AppShell:105, 123 |
| A-159 | Mobile nav | Mobile, OP | 1) Open drawer | 3 items, "Sign out" at bottom of the drawer, reachable by scroll | P2 | Mobile | AppShell:145-189 |
| A-160 | Sign out | Mobile | 1) Open drawer 2) Tap "Sign out" | Landing page; drawer state irrelevant | P1 | Mobile | AppShell:186 |
| A-161 | Deep link | TRAV-DONE logged in | 1) Open `https://drifttravel.app/trips`, `/profile`, `/explore` directly | All show the same default tab (Explore); no URL routing (D-A-7). Record expected product behaviour | P1 | Edge | AppShell:41, no router |
| A-162 | Deep link | Logged in on Profile | 1) F5 | Returns to Explore (tab not persisted) | P2 | Edge | AppShell:41 |
| A-163 | Back button | Logged in | 1) Click Trips, Stays, Bookings 2) Press browser Back | Leaves the site to the previous page (tab changes never push history) | P2 | Edge | AppShell:153 |
| A-164 | Back button | Login flow | 1) Landing then Sign in then Forgot password 2) Browser Back | Leaves the site, not to the previous form | P3 | Edge | Login:10 |
| A-165 | Shell | Any | 1) Resize between 767 and 769 px | Breakpoint switch is exact at 768; layout correct on both sides | P3 | UI | useIsMobile:3 |

### 3.10 Profile

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-166 | Profile | TRAV-DONE | 1) Click Profile | "Loading..." then Profile card: avatar initial, name, email, four disabled inputs, Budget, Activities, Travel style cards, My Posts | P1 | UI | Profile:25-36, 59-160 |
| A-167 | Profile | Traveller with no name | 1) Open Profile | Avatar shows email initial; name line blank | P3 | UI | Profile:70-72 |
| A-168 | Profile | TRAV-DONE | 1) Click "Edit profile" | Button label changes to "Save changes"; four inputs become editable | P1 | UI | Profile:63, 81-94 |
| A-169 | Profile | Edit mode | 1) First name `Sam` 2) Last name `Lee` 3) Phone `+61 400 000 000` 4) Bio `Loves diving` 5) Click "Save changes" | "Saving..." then read-only; PATCH body has the 4 fields; refresh and re-open shows values persisted | P1 | API | Profile:38-45, travelers.ts:128-158 |
| A-170 | Profile | Edit mode | 1) Clear the phone field 2) Save | Phone is NOT cleared (empty is sent as undefined, D-A-15); after reload the old value returns | P1 | Edge | Profile:41 |
| A-171 | Profile | Edit mode, all four fields emptied | 1) Save | PATCH `{}` returns 400 "No fields to update"; UI stays in edit mode with no message (D-A-15) | P2 | Validation | travelers.ts:131-133, Profile:43 |
| A-172 | Profile | Edit mode | 1) Phone of 21 characters 2) Save | 400 "Validation error"; no message in UI; remains in edit mode | P2 | Validation | travelers.ts:70, Profile:43 |
| A-173 | Profile | Edit mode | 1) Bio of 1001 characters 2) Save | 400; silent failure | P2 | Validation | travelers.ts:73 |
| A-174 | Profile | Edit mode | 1) First name of 101 chars 2) Save | 400; silent failure | P3 | Validation | travelers.ts:68 |
| A-175 | Profile | Edit mode | 1) Type a name 2) Reload the page without saving | Change discarded; no unsaved-changes warning; no Cancel button exists | P3 | Edge | Profile:63 |
| A-176 | Profile | Edit mode | 1) Double-click "Save changes" | Button disabled while saving; one PATCH | P2 | Edge | Profile:63 |
| A-177 | Profile | Not editing | 1) Click into inputs | Disabled, cannot type | P2 | UI | Profile:81-94 |
| A-178 | Profile | Edit mode, network offline | 1) Save | No message; button re-enables; stays in edit mode | P2 | Edge | Profile:43-44 |
| A-179 | Profile | Prefs chips | 1) Click "Luxury" under Budget | Chip turns gold at once; PUT /travelers/me/preferences returns 404 (no route, D-A-2); reload shows the old value; console shows an unhandled rejection | P1 | API | Profile:47-52, travelers.ts |
| A-180 | Profile | Prefs chips | 1) Click "Diving", "Surfing" under Activities | Chips toggle in the UI, nothing persists (route missing and no `activity_types` column); after reload none selected | P1 | API | Profile:115-119 |
| A-181 | Profile | Prefs chips | 1) Click "Solo" and "Couple" under Travel style | Toggle in UI; not saved | P1 | API | Profile:125-129 |
| A-182 | Profile | Traveller whose onboarding saved `budget_range=upper_mid` | 1) Open Profile | No Budget chip highlighted (only budget, mid, luxury exist; D-A-24); `travel_style` values like group_of_friends never match "Group" | P2 | Edge | Profile:6-7 |
| A-183 | Profile | Rapid chip clicks (5 in a second) | 1) Click Budget chips rapidly | UI follows the last click; requests all fail (route missing) | P3 | Edge | Profile:47-52 |
| A-184 | Profile | Traveller with 0 posts | 1) Scroll to "My Posts" | "No posts yet. Share something from the Feed tab." | P1 | UI | Profile:137-139 |
| A-185 | Profile | Traveller with posts (one with region, one public, one private) | 1) Scroll | Newest first; region pill, body, thumbs-up count, comment count, date; posts listed are the user's own; deleted posts absent; posts have no edit/delete controls | P1 | UI | Profile:141-157, community.ts:459-484 |
| A-186 | Profile | Posts request fails | 1) Block GET /community/posts | Empty state text shown (error swallowed) | P3 | Edge | Profile:22 |
| A-187 | Profile | Mobile 375px | 1) Open Profile 2) Edit | First and last name sit side by side in one row (fieldRow is not wrapped); check inputs are not squeezed and Save is reachable | P2 | Mobile | Profile:167-178 |
| A-188 | Profile | Concurrent edits | 1) Edit in two tabs, save both | Last write wins per field; no crash | P3 | Edge | travelers.ts:128 |
| A-189 | Profile | Direct API | 1) PATCH /travelers/me `{"date_of_birth":"01-02-2000"}` | 400 (format YYYY-MM-DD) | P3 | API | travelers.ts:72 |
| A-190 | Profile | Direct API | 1) PATCH `{"avatar_url":"notaurl"}` | 400 | P3 | API | travelers.ts:74 |
| A-191 | Profile | Direct API | 1) POST /profile/avatar with a 20 kB base64 image | 413 style error from the 10kb JSON limit; no UI uses it (D-A-29) | P3 | API | index.ts:49, profile.ts:12 |
| A-192 | Profile | Direct API, no token | 1) GET /travelers/me and /travelers/me/preferences with no Authorization | 401 "Unauthorized" | P1 | Security | authenticate.ts:20-22 |

### 3.11 Trip Mode toggle (hook in scope)

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| A-193 | Trip Mode | TRAV-DONE on the Safety tab, browser location allowed | 1) Click the toggle | POST trip-mode {enabled:true} 200; toggle turns gold; within seconds POST /safety/location {latitude, longitude} 201 | P1 | UI | useTripMode:122-141, safety.ts:38-68 |
| A-194 | Trip Mode | Same | 1) Click toggle off | Toggle off; POST trip-mode {enabled:false}; presence purged | P1 | UI | useTripMode:143-152 |
| A-195 | Trip Mode | Location permission denied | 1) Click toggle | Toggle stays ON and an error appears ("User denied Geolocation"); consent already recorded server side; no location is shared (D-A-17) | P1 | Edge | useTripMode:134-140 |
| A-196 | Trip Mode | Trip Mode enabled then F5 | 1) Reload and open Safety | Toggle shows OFF although consent is granted server side (no GET, D-A-17) | P2 | Edge | useTripMode:105 |
| A-197 | Trip Mode | Moving less than 250 m within 5 min | 1) Enable and watch network | Location POSTs at most every 5 min unless 250 m moved | P2 | API | useTripMode:86-88, 110-120 |
| A-198 | Trip Mode | API down | 1) Click toggle | Error line "Could not enable Trip Mode. Please try again." and toggle stays off | P2 | Edge | useTripMode:124-129 |
| A-199 | Trip Mode | Operator or admin token | 1) POST /safety/location | 403 "Only travelers can submit location updates" | P3 | Security | safety.ts:39-41 |
| A-200 | Trip Mode | Two toggles (Safety and WhosGoingPanel) | 1) Turn on in one place, open the other | Each instance has independent state (hook local state) | P3 | Edge | useTripMode:105 |

Test case count: 200 IDs are used (A-001 to A-200), of which every one is listed above.

---

## 4. Suspected defects

Severity: 1 = feature or session broken for many users, 2 = major path broken or unsafe, 3 = wrong or confusing behaviour, 4 = minor or cosmetic.

| ID | Sev | What is wrong | Evidence (file:line, both sides) | Confirmed |
|---|---|---|---|---|
| D-A-1 | 1 | `user` is null after every page reload. Only login/register fill it; nothing rehydrates it (`setUser` is never dispatched, no /auth/me route). Result after F5: operators get the traveller nav and land on Explore instead of Dashboard, the admin loses the Admin button, nav badge polling stops, and the onboarding check is skipped for travellers | authSlice.web.ts:177-182 (user null, isAuthenticated from token), :67 setUser unused (grep shows no dispatch); AppShell.web.tsx:41, 49, 66, 68; App.web.tsx:25-27; no `/auth/me` in auth.ts | CODE |
| D-A-2 | 1 | Every Profile preference chip (Budget, Activities, Travel style) silently fails to save. UI sends `PUT /travelers/me/preferences` but the API has only GET and PATCH; deployed container `dist/routes/travelers.js` has no `.put(`. Even with a PATCH, `activity_types` is not a `member_preferences` column nor whitelisted. Request rejection is not caught | ProfileScreen.web.tsx:47-52, 107, 118, 128; travelers.ts:161, 183 (no PUT), :78-101 (no activity_types); 002_member_preferences.sql has no activity_types (only utils/schema.sql:40 legacy) | CODE |
| D-A-3 | 2 | Profile tab is offered to operators (and probably admins) but `GET /travelers/me` returns 404 for them (no travelers row), so the tab shows "Loading..." forever. Also any load failure has no error state | AppShell.web.tsx:72; ProfileScreen.web.tsx:26-35, 57; travelers.ts:117-119; auth.ts:86-91 (travelers row only for role traveler) | CODE (operator); RUNTIME (admin) |
| D-A-4 | 2 | Admin button opens `/admin.html` which does not exist in the deployed site (404); `/admin` redirects there too. webpack `clean:true` with no copy step removes any manually placed file on each build | AppShell.web.tsx:168; web/dist has only index.html and one bundle; nginx `location = /admin` and `~* \.html$ try_files $uri =404`; webpack.config.js output.clean, no CopyPlugin | CODE |
| D-A-5 | 2 | Onboarding "Continue" is not disabled while saving. A double-click runs `handleNext` twice with the same `currentStep`, and both call `setCurrentStep(s=>s+1)`: step 2 is skipped, unreachable Step 3 appears ("3 of 2"), onboarding is never marked complete, and continuing through the dead steps reaches index 9 where `STEP_COMPONENTS[9]` is undefined and React throws (white screen) | OnboardingScreen.web.tsx:84, 136, 546-558, 516, 522, 563, 575; no ErrorBoundary (grep) | CODE for path; RUNTIME for timing |
| D-A-6 | 2 | Field-level validation errors never reach the user. Server returns `{message:'Validation error', errors:[...]}`; the UI shows only `message`. Affected: register (bad email, common password, password contains email, terms, over 100 chars), login (bad email), forgot (bad email), reset (common password), profile save (silent) | auth.ts:113, 152, 234, 274; travelers.ts:153; authSlice.web.ts:196-198, 212; Login:76-77, 124, 140. There is no client email format check (buttons are not in a `<form>`) | CODE |
| D-A-7 | 2 | No URL routing at all: tabs are local state, so deep links (`/trips`, `/profile`), refresh (returns to Explore or Dashboard) and the browser Back button do not work; Back leaves the site | AppShell.web.tsx:41, 87-102, 153; grep of web/src finds no router, `pushState` or `popstate` | CODE |
| D-A-8 | 2 | "Sign out" only clears localStorage. `POST /auth/logout` (which deletes the Redis refresh session) is never called, so a stolen refresh token stays valid for 7 days | authSlice.web.ts:217-219; auth.ts:282-301; grep shows no caller of /auth/logout | CODE |
| D-A-9 | 2 | `POST /waitlist/use-invite` does not exist. Invite registration ignores the 404. Nothing in the backend ever sets waitlist status `joined`, so invites stay reusable and the admin "joined" count is always 0 | Login.web.tsx:93; waitlist.ts:22, 76, 97 (only routes); grep for "joined" shows only reads (waitlist.ts:34, 113, 201); deployed dist waitlist.js has no use-invite | CODE |
| D-A-10 | 2 | Invite link failures always show the generic message. Server sends 404/409/410 with a specific `message`; axios throws, and the `catch` hardcodes the text. The `valid===false` branch is unreachable | Login.web.tsx:34-50; waitlist.ts:108, 114, 118 | CODE |
| D-A-11 | 2 | Onboarding Back loses input and can wipe saved answers. Each step keeps its own state and remounts empty; resubmitting sends empty arrays and empty strings which overwrite saved values (arrays replaced, scalars set to null) | OnboardingScreen.web.tsx:45-46, 89-90, 561, 563; travelers.ts:203-208, 214-216 | CODE |
| D-A-12 | 2 | Refresh handling is fragile. (a) Single Redis slot `refresh:<id>`: logging in on a second browser or device invalidates the first, forcing logout within 15 minutes. (b) When the 15-minute access token expires, AppShell fires two calls in the same tick; both refresh with the same old token and one can fail because the rotation already replaced it, and its catch does `tokenStorage.clear()` plus redirect, wiping the freshly saved tokens | auth.ts:143, 173-176, 188; api.web.ts:315-330; AppShell.web.tsx:50-61 | CODE for (a); RUNTIME for (b) |
| D-A-13 | 3 | Onboarding is only 2 steps but the code carries 7 unreachable steps (dead code), the header says "Travel Tool" instead of Drift, and the final "Continue" button on step 2 does not say it completes. No Skip. Landing copy promises "Takes five minutes" | OnboardingScreen.web.tsx:11-21, 142-514, 516-522, 568; Landing:195 | CODE |
| D-A-14 | 3 | After login or register the traveller sees the app (Explore) first, then Onboarding jumps in when the status call returns: `checking` is already false and `onboardingDone` is already true from the logged-out run of the effect. A status error is treated as "done" (fail open). Switching users in one tab reuses the previous user's state | App.web.tsx:21-28, 35, 41-42 | CODE for cause; RUNTIME for visual |
| D-A-15 | 3 | Profile save: no success or error message, no Cancel, cannot clear a field (empty sent as undefined), all-empty save gives 400 silently, and validation failures (phone over 20, bio over 1000) leave the user in edit mode with no explanation | ProfileScreen.web.tsx:38-45; travelers.ts:67-75, 131-133 | CODE |
| D-A-16 | 3 | Profile load failure (500, network, 404) leaves "Loading..." forever; `Promise.all` also fails as a whole if only preferences fail | ProfileScreen.web.tsx:26-36, 57 | CODE |
| D-A-17 | 3 | Trip Mode toggle lies: after a location permission error the switch stays ON; unsupported geolocation leaves consent recorded on the server while the switch is off; state is not restored on reload because the API has no read endpoint | useTripMode.web.ts:105, 122-141, 134-140; safety.ts:99-110 | CODE |
| D-A-18 | 3 | Onboarding error and "Saving..." banners render above the step, far from the Continue button (below the fold, especially on mobile), and there is no Sign out or way to leave the flow | OnboardingScreen.web.tsx:565-583 | CODE |
| D-A-19 | 3 | Mixed signals: waitlist form says "invite-only" but register is open; the landing "List your business" button opens register with the Traveller role selected instead of Operator | Login.web.tsx:172-174, 234-235, 16; Landing.web.tsx:247 | CODE |
| D-A-20 | 3 | Rate limits are easy to trip: all failures on `/api/v1/auth/*` (login typos, 400s, refresh 401s) share 10 per 15 min per IP; register allows 5 per hour per IP counting every attempt, including failures. Offices, schools and testers behind one IP get locked out | rateLimit.ts:83-90, 98-104; index.ts:57; auth.ts:62 | CODE; RUNTIME for behaviour |
| D-A-21 | 3 | Admin role gets the full traveller nav (including Safety, Profile, Members, Messages) but traveller-only routes reject or 404 for admin (`POST /safety/location` 403, `/travelers/me` 404 if no row) | AppShell.web.tsx:66-85; safety.ts:39-41; travelers.ts:117-119 | CODE for routes; RUNTIME for admin data |
| D-A-22 | 3 | Stale error banner survives mode changes: switching from register to login (and from waitlist to login) does not clear `error` | Login.web.tsx:210, 283 (setMode without setError) vs :399 which clears | CODE |
| D-A-23 | 3 | Reset-password page: first paint shows Landing then switches (effect runs after mount); URL keeps `?token=` after success so a refresh shows the reset form with a dead token; a trailing slash `/reset-password/` is not recognised | Login.web.tsx:10, 57-68, 338 | CODE |
| D-A-24 | 4 | Profile chip vocabulary does not match onboarding: Budget offers budget, mid, luxury but onboarding stores upper_mid and ultra_luxury; Travel style offers Group and Family but onboarding stores group_of_friends and family_with_kids; Activities reads a column that does not exist | ProfileScreen.web.tsx:5-7, 116, 126; OnboardingScreen.web.tsx:60, 101 | CODE |
| D-A-25 | 4 | Landing copy glitches: "Live in Bali destinations worldwide" when regions is 1 or less; the members stat is fetched and never shown | LandingScreen.web.tsx:66-70, 98 | CODE |
| D-A-26 | 4 | Login timing side channel: the dummy hash is not a valid 60-char bcrypt hash so comparing it returns immediately, making unknown emails faster; register 409 also confirms an email exists | auth.ts:133-135, 75 | RUNTIME |
| D-A-27 | 4 | Mobile drawer: closed drawer is only moved off-screen (keyboard focus still reaches it), no Escape to close, and `100vh` shell can hide content under mobile browser toolbars | AppShell.web.tsx:127-136, 200 | CODE for focus; RUNTIME for viewport |
| D-A-28 | 4 | Waitlist returns "Invalid email address." for any zod failure (for example name over 100), and the inputs have no maxLength | waitlist.ts:12-13, 65; Login.web.tsx:180-198 | CODE |
| D-A-29 | 4 | Orphaned code: UnderConstructionScreen is unused; `/profile/avatar` and `/profile/me` have no UI (avatar upload would also exceed the 10kb JSON limit); nationality and date_of_birth have no fields; Redux `error` and `isLoading` unused | UnderConstructionScreen.web.tsx:21 (no importer); profile.ts:12, 40; index.ts:49; authSlice.web.ts:107 | CODE |
| D-A-30 | 4 | `authenticate` queries the database on every request although the comment says every 5 minutes; extra load with the 15-second badge poll | authenticate.ts:33-40 | CODE |
| D-A-31 | 3 | No React ErrorBoundary: any render exception (see D-A-5) blanks the whole app with no recovery | grep for ErrorBoundary and componentDidCatch in web/src returns nothing; index.web.tsx:11-15 | CODE |

Defect counts: severity 1: 2 (D-A-1, D-A-2); severity 2: 10 (D-A-3 to D-A-12); severity 3: 10 (D-A-13 to D-A-23 excluding none plus D-A-31, that is 13-23 = 11 minus the two listed as 4... see table for the authoritative severity column); severity 4: 8. Use the Sev column above as the source of truth. Total defects: 31.
