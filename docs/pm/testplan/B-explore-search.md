# B - Explore, Search, Place/Operator Detail, Claims, Reviews, Booking Offers, Photos

Scope: `web/src/screens/ExploreScreen.web.tsx` (1,418 lines, read in full) plus the AppShell wiring, and backend `search.ts`, `discover.ts`, `recommendations.ts`, `offers.ts`, `operators.ts`, `reviews.ts`, `photos.ts` and services `searchCache`, `googlePlaces`, `foursquare`, `viator`, `discovery`, `recommendations`, `booking`, `memberPlaces`, `dedup`, `geocoding`.
Method: code reading plus read-only schema checks (`\d`) and aggregate counts on the live DB. No live API calls, no browser.
Paths are relative to `/home/andre/projects/drift`. "Confirmed" = proven by code and/or live schema. "Runtime" = needs a runtime check.

## 0. Live facts that shape the plan (aggregate queries only)

| Fact | Value | Consequence |
|---|---|---|
| places_cache rows by source | google 1,800; google_places_v2 841; nothing else | No viator, foursquare or member rows exist |
| bookable_offers rows | 0 | "Check availability" and "Claimed by operator" booking CTAs cannot appear today |
| VIATOR_API_KEY / FOURSQUARE_API_KEY in backend container | not set (only GOOGLE_PLACES_API_KEY is set) | `viatorEnabled()` and `foursquareEnabled()` are false, so no new Viator or Foursquare rows |
| operators | 2 (both verified, region Nusa Penida, no geo, both have images); listing_claims 0; reviews 0; places with is_claimed 0 or operator_id 0 | The only Verified badges are the 2 operator cards; Claimed badge never shown; there are no reviews |
| photo refs | google: 1,104 v1 refs (`places/..`), 682 legacy `photo_reference` refs; google_places_v2: 838 v1 refs; 17 rows with no photos | 25% of the catalog depends on the legacy Places photo API; v1 names expire (2,271 of 2,641 rows not updated in 30 days) |
| expired google rows | 661 of 1,800 have expires_at in the past | These are invisible to Explore |
| regions in catalog | 37, including non-canonical names `solarno` (69 fresh rows), `Nusa`, `Labuan`, `Gili` | Featured pills can show misspelled or partial destinations |
| Live table drift | `listing_claims` = (id, place_id, user_id, status, created_at) but code uses place_cache_id, operator_id, evidence, reviewed_by, reviewed_at; `reviews` has no `title`; `places_cache` has no `claimed_at`; function `compute_operator_trust_score` does not exist | Every claim and review route breaks (see section 4) |
| Rate limits | `/api/` 300 per min per IP; `/api/v1/search/*` 60 per min per IP (rateLimit.ts:28,37; index.ts:53,63). `trust proxy` = 1 (index.ts:44) behind nginx behind a cloudflared tunnel | If nginx sees 127.0.0.1 for every visitor, all users share one bucket (Runtime) |

Test users referenced: T1 = traveller with onboarding preferences; T2 = traveller without preferences; OP = operator account (role operator); AD = admin; ANON = signed-out.
Test data: region "Nusa Penida" (has the 2 operators), "Ubud" or "Canggu" (deep catalog), "Bangkok" (25 sub-areas), "Lisbon" (3 sub-areas), "Salerno", "Florence", a never-searched city (e.g. "Windhoek").

## 1. Screen and control inventory

Explore is one screen with three mutually exclusive views: (a) landing (no region, no category, no filter text): pills plus spotlight; (b) region view with sections (region set, no category, no filter text); (c) flat grid (category or filter text set). Selecting a card swaps the whole screen for DetailPanel (local state `selected`, no URL or history entry).

| ID | Control | File:line | Does what | API call |
|---|---|---|---|---|
| C-01 | Destination text input | ExploreScreen:706-711 | Sets `destInput` | none |
| C-02 | "Explore" button / Enter in form | :700-715 | `exploreDestination(destInput)` then clears input | GET `/search` `{q:"",region,limit:1}` timeout 20s, reads `geo.name`; then region state triggers GET `/recommendations`, GET `/search/subregions`, 4x GET `/recommendations` (sections); writes localStorage `drift_region`, `drift_recent_destinations` |
| C-03 | "Clear" (only when region set) | :723 | `clearDestination`: region "" and removes `drift_region`; does NOT reset category, search or selected | none (fetchResults early-exits only if category also empty) |
| C-04 | Active-trip pills "✈ dest" | :733-739 | `exploreDestination(t.destination)` | as C-02; list from GET `/safety/trips` (:616) |
| C-05 | Quick-pick pills (recents + featured, max 8; landing only) | :752-759 | `exploreDestination(r)` | as C-02; featured from GET `/discover/destinations` |
| C-06 | "Somewhere new" pills (landing only) | :772-778 | `exploreDestination(d.region)` | as C-02 |
| C-07 | "Filter these results..." input | :787-792 | Sets `search`; client-side filter of already loaded items only | none (sections effect toggles) |
| C-08 | Category chip "All" | :804-816 | `setCategory("")` | GET `/recommendations` |
| C-09 | Category chip "Food & drink" | :804-816 | `setCategory("food")`; disabled without region | GET `/recommendations?category=food&region=&limit=20&sub_area=` |
| C-10 | Category chip "Accommodation" | same | `setCategory("accommodation")` | same |
| C-11 | Category chip "Activities" | same | `setCategory("activity")` | same |
| C-12 | Category chip "Transport" | same | `setCategory("transport")` | same |
| C-13 | Sub-area chip "All {region}" (only if 2 or more sub-areas) | :827-836 | `setSubArea("")` | GET `/recommendations` (+4 section calls) |
| C-14 | Sub-area chips (per slug, toggle) | :838-848 | `setSubArea(slug or "")` | GET `/recommendations?...&sub_area=slug` |
| C-15 | Result card (click) | :78-90, 647-659 | Opens DetailPanel, tracks view | POST `/recommendations/interact` `{entity_type,entity_id,interaction_type:"view",region,category,tags}` |
| C-16 | Result card keyboard (Enter or Space) | :84-89 | Same as C-15; handler does not check `e.target` | as C-15 |
| C-17 | Save heart on card | :106-116, 632-645 | Toggle save, then updates local `saves` Set | POST `/recommendations/save` `{entity_type,entity_id}`, reads `saved` |
| C-18 | Card photo `<img>` | :93-99, 14-22 | `/api/v1/photos?ref=` for Google refs or the raw URL; onError hides img (no fallback) | GET `/photos?ref=` |
| C-19 | "See all →" per section | :963-968 | `setCategory(cat)` | GET `/recommendations` |
| C-20 | Horizontal section scroller | :970-985 | Native overflow-x scroll, no arrows | none |
| C-21 | "Load more" (category view, no filter text) | :898-906, 489-513 | Appends next 20 | GET `/recommendations?...&offset=results.length` |
| C-22 | Detail "✕ Close" | :284-286 | `setSelected(null)` | none |
| C-23 | Detail photo (first photo only) | :287-296 | Single image, no gallery | GET `/photos` |
| C-24 | Detail "Website" link | :334-342 | Opens new tab | none |
| C-25 | Detail phone | :344 | Plain text, not a tel: link | none |
| C-26 | "Request booking" (operator items only) | :346-350, 685-688 | `onSelectOperator(item)` → AppShell `setDetail`, then `setSelected(null)`; ExploreScreen never reads `detail` | none (POST `/bookings` is never called from web) |
| C-27 | BookingOffers: "Visit {operator}" link | :239-249 | External link plus click tracking | GET `/offers/place/:id` (render), POST `/recommendations/interact` type "book" |
| C-28 | BookingOffers: operator phone text | :250-252 | Text only | as C-27 |
| C-29 | BookingOffers: "Check availability" | :262-270 | External Viator link plus tracking | as C-27 |
| C-30 | Spotlight cards (landing) | :927-936 | ResultCard reuse, `personalized=false` | GET `/discover/spotlight` |
| C-31 | aria-live announcement region | :862-864 | Screen reader text only | none |
| C-32 | Mount: restore region, load trips | :612-630 | `setRegion(localStorage drift_region)`; loads trips | GET `/safety/trips` (reads `safety_status`, `destination`) |
| C-33 | Mount: auto-explore active trip (if no saved region) | :624-626 | Calls `exploreDestination` with no click | GET `/search` (live Google fan-out) |
| C-34 | Mount: destinations load | :550-560 | Fills pills | GET `/discover/destinations` (reads `featured`, `somewhereNew`) |
| C-35 | Landing spotlight load | :564-572 | Fills spotlight | GET `/discover/spotlight` (reads `results`) |
| C-36 | Subregions load on region change | :419-429 | Fills sub-area chips, resets subArea | GET `/search/subregions?region=` |
| C-37 | AppShell nav "Explore" | AppShell.web.tsx:147-165 | Sets tab, `setDetail(null)`; unmounts Explore (loses category, search, saves, selected) | none |
| C-38 | AppShell hamburger (mobile) | :108-114 | Toggles drawer | none |
| C-39 | AppShell backdrop (mobile) | :123-125 | Closes drawer | none |
| C-40 | AppShell "Sign out" | :186 | `logout` clears tokens only; leaves `drift_region` and recents in localStorage (authSlice.web.ts:57) | none |

Not present in the UI (grep of `web/src` finds no code): sort control, price, rating or open-now filters, radius or "near me", map/list toggle, infinite scroll, photo gallery or lightbox, share, report, claim this listing, contact or message operator, reviews read or write, "who's going" on a place, save from detail, saved-items list (GET `/recommendations/saved` is never called), booking form for operators, location-permission prompt (`geolocation` is used only in `useTripMode.web.ts`). `WhosGoingPanel` exists only in Community and Trips.

## 2. API contract check

| UI call | Backend route file:line | Match? | Problem |
|---|---|---|---|
| GET `/search` `{q:"",region,limit:1}` (ExploreScreen:584) | search.ts:27; schema :15-24 | Yes | Reads `geo.name` (returned :39-48, null if geocode fails). Not a read-only call: fans out to Google (searchCache.ts:417-461) and upserts. 60 per min limit; a 20s client timeout can abort while the server keeps working (Runtime). Never sends `q`, so text search is client-side only |
| GET `/search/subregions` `{region}` (:426) | search.ts:91 | Yes | `{subregions:[{name,slug,count}]}` matches (searchCache.ts:311-334). Counts against the 60 per min search bucket |
| GET `/recommendations` `{category,region,sub_area,limit,offset,refresh}` (:455,501,534) | recommendations.ts:10 (routes file) | Yes | Response fields read (`results`, `hasMore`, `personalized`) are returned (:28-33). `personalized` is `!!req.user`, true even with no preferences. Cached per user for 1h (services/recommendations.ts:549-556,712). `refresh` only sent on the mixed call after a search, not by the 4 section calls |
| Result fields read by cards | services/recommendations.ts:656-682 | Partial | Returned: id,type,name,category,description,region,address,rating,review_count,price_level,photos,tags,is_claimed,is_verified,community,website,phone. **`trust_tier` (read at UI :124,127) is never returned** by recommendations, search, or spotlight. `is_verified` for places is hard-coded false (:594) |
| GET `/operators` `{category,region}` fallback (:468) | operators.ts:25 | Route yes, fields NO | Returns `business_name`, `avg_rating`, no `name`, `rating`, `photos`, `tags`. Cards render blank names, no rating, no photo |
| GET `/discover/destinations` (:552) | discover.ts:9 | Yes | `featured`, `somewhereNew` `[{region,country}]` returned (discovery.ts:113-137) |
| GET `/discover/spotlight` (:568) | discover.ts:23 | Yes | Returns `{results}`; items lack description, website, phone, address, community, is_verified (discovery.ts:166-194), so DetailPanel is sparser than for the same place from /recommendations |
| GET `/safety/trips` (:617) | safety.ts:382 | Yes | Reads `safety_status` and `destination`, both selected |
| POST `/recommendations/save` (:634) | recommendations.ts:69 | Yes | Body matches; `{saved}` read. Non-uuid entity_id gives 500 (toggleSave, uuid column). No entity existence check. Every save inserts another "save" interaction (services:787) |
| POST `/recommendations/interact` (:213,650) | recommendations.ts:42 | Yes | Body matches; 204. `tags` unbounded. Non-uuid id is swallowed inside trackInteraction try/catch (services:759) and still returns 204. `redis.keys` per call (:755) |
| GET `/offers/place/:id` (:189) | offers.ts:12 | Yes | `{offers:[{id,name,category,priceAmount,priceCurrency,checkoutUrl,operatorContact{name,phone,website}}]}` matches UI reads (booking.ts:126-140). Only `source='viator'` places can ever produce an offer (booking.ts:153); live DB has 0 viator rows. Non-uuid id gives 500 |
| GET `/photos?ref=` (:14-22) | photos.ts:21 | Yes | Public. Regex allows any `[A-Za-z0-9_\-/]+` (:30). Heal only if Google returns 400 (:54); other statuses give 502. UI never sends `w` (always 800) |
| Operator "Request booking" (C-26) | none reached | NO | Handler ends in AppShell `setDetail`, which nothing renders. `POST /bookings` (bookings.ts:24) is never called from web |
| (Claim UI absent) POST `/operators/claims` | operators.ts:125 | Backend broken | Uses `listing_claims.place_cache_id`, `operator_id`, `evidence` (:148,167); live columns are place_id, user_id |
| (Claim UI absent) POST `/search/places/:id/claim` | search.ts:130-199 | Backend broken | :170 and :183 use `place_cache_id`, `operator_id`, `evidence` |
| (absent) GET `/operators/claims` | operators.ts:188-218 | Backend broken | :198,200,206,207 nonexistent columns |
| (absent) GET `/search/claims` | search.ts:202-228 | Backend broken | :212,215,216 |
| (absent) GET `/operators/claims/queue` | operators.ts:303-326 | Backend broken | :311,322,323 |
| (absent) PATCH `/operators/claims/:id` | operators.ts:221-300 | Backend broken | :233-236 place_cache_id; :250 reviewed_by, reviewed_at; :278 `compute_operator_trust_score` does not exist. Approval sets `operator_id` and `operators.is_verified` but never `places_cache.is_claimed` (UI badge reads `is_claimed`) |
| (absent) PATCH `/search/claims/:id` | search.ts:231-278 | Backend broken | :245-248 reviewed_by, reviewed_at, place_cache_id, operator_id; :262 `places_cache.claimed_at` does not exist |
| (absent) GET `/operators/search-places` | operators.ts:85-121 | Backend broken | :108 `lc.place_cache_id` gives 500 for every query |
| (absent) GET `/operators/:id`, `/operators`, POST/PATCH `/operators` | operators.ts:337,25,367,420 | Works | Non-uuid `:id` gives 500 (:339). Lat/lng/radius NaN gives 500 (:63-71) |
| (absent) POST `/reviews` | reviews.ts:17-83 | Backend broken | INSERT column `title` (:61) does not exist on `reviews` |
| (absent) GET `/reviews/operator/:id`, GET `/reviews/me` | reviews.ts:87,130 | Backend broken | SELECT `r.title` (:92,133) |
| (absent) GET `/recommendations/saved` | recommendations.ts:91 | Works, never called | No saved-items screen on web |
| (absent) GET `/search/places/:id` | search.ts:108 | Works, never called | Detail never fetches full place; `enrichPlace` (phone, website) is never triggered by the UI. Non-uuid gives 500 |

## 3. Test cases

Columns: ID | Area | Precondition / test data | Steps | Expected result | Priority | Type | Source.
Where the current code fails the expected result, the row says "(fails today: D-B-n)".

### 3.1 Landing (no destination)

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-001 | Landing | T1, clean localStorage, no trips | 1) Sign in 2) Click sidebar "Explore" | Header "For you"; input, Explore button; up to 6 featured pills; "Somewhere new" row of 2; 4 non-All chips greyed and disabled; "Popular starting points" grid (about 6 cards, 2 per region for 3 regions); no Clear button | P1 | UI | ExploreScreen:720,750-782,809-812,914-940; discover.ts:23 |
| B-002 | Landing | Block `/discover/destinations` (DevTools) | 1) Load Explore | No pills, no "Somewhere new", no crash; typed search still works | P2 | Edge | :550-560 |
| B-003 | Landing | Block `/discover/spotlight` | 1) Load Explore | Spinner then "Search a destination above to start exploring." (no permanent spinner) | P2 | Edge | :564-572,916-919 |
| B-004 | Landing | Any spotlight card | 1) Click card | Detail opens with name, category, region, rating; description, website, phone absent (payload lacks them); compare with same place under region view | P2 | UI | discovery.ts:166-194 |
| B-005 | Landing | T1 | 1) Click heart on a spotlight card | POST `/recommendations/save` entity_type "place"; heart red; aria-pressed true | P2 | UI | :106-116 |
| B-006 | Landing | Live catalog (`solarno`, `Nusa`, `Labuan`, `Gili` regions) | 1) Reload landing on several days 2) Read pills | Only valid canonical destinations shown (fails today: D-B-20) | P2 | Edge | discovery.ts:38-46 |
| B-007 | Landing | Fresh load, no destination | 1) Click "Filter these results..." 2) Type "cafe" | Should filter the spotlight or show a hint; today "Finding places for you..." forever (fails today: D-B-7) | P1 | Edge | :373,439-443,866-872 |
| B-008 | Landing | No region | 1) Click "Food & drink" chip | Nothing happens; button disabled; no request | P2 | UI | :812 |

### 3.2 Destination search

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-009 | Destination | Known region | 1) Type "Ubud" 2) Click Explore | Input clears; header "Exploring Ubud"; Clear appears; pills hidden; 4 section rows; localStorage `drift_region`=Ubud; recents updated | P1 | UI | :577-604,719-727 |
| B-010 | Destination | same | 1) Type "Canggu" 2) Press Enter | Same as B-011 | P1 | UI | :700-704 |
| B-011 | Destination | any | 1) Click Explore with empty input 2) Type 3 spaces and Enter | No request; no state change (no feedback shown) | P2 | Validation | :578-579 |
| B-012 | Destination | Never-searched city "Windhoek" | 1) Type Windhoek 2) Explore 3) Watch network | GET `/search?q=&region=Windhoek&limit=1` (up to 20s); loading text; then results; source google; subregion chips if coverage 5 or more | P1 | UI | :584-590; searchCache.ts:417-461 |
| B-013 | Destination | any | 1) Type "lisbon portugal" 2) Explore | `geo.name` "Lisbon" used; header "Exploring Lisbon"; recents show "Lisbon" | P1 | UI | :588 |
| B-014 | Destination | Throttle `/search` beyond 20s | 1) Explore "Windhoek" | Should still land on canonical region; today the timeout leaves region = typed text (fails today: D-B-11) | P1 | Edge | :584-591 |
| B-015 | Destination | Force 429 on `/search` | 1) Submit 61 destinations in 60s or mock 429 | User told to retry; today silent, region = typed text | P2 | Edge | rateLimit.ts:28; :589-591 |
| B-016 | Destination | any | 1) Type "asdfghjkl" 2) Explore | Message "couldn't find that place"; not added to recents (fails today: D-B-24) | P2 | Edge | :592-600 |
| B-017 | Destination | any | 1) Type `<img src=x onerror=alert(1)>` 2) Explore | Rendered as plain text in header and recents; no script runs | P2 | Security | :720,758 |
| B-018 | Destination | landing | 1) Click first featured pill | Explores it; pill row disappears | P1 | UI | :752-759 |
| B-019 | Destination | landing | 1) Explore A 2) Explore B 3) Explore C 4) Clear | Pills: C, B, A first then featured minus duplicates (case-insensitive), max 8 | P2 | UI | :594-599,671-677 |
| B-020 | Destination | landing | 1) Click a "Somewhere new" pill | Explores it | P2 | UI | :772-778 |
| B-021 | Destination | T1 with planned or active trip "Bali" | 1) Load Explore | "✈ Bali" pill above; click explores | P2 | UI | :730-741 |
| B-022 | Destination | T1 with trip, empty localStorage | 1) Load Explore | Auto-explores trip destination with no click (triggers Google fan-out); confirm intended | P3 | Edge | :624-626 |
| B-023 | Destination | any | 1) Click Explore 5 times fast with "Ubud" typed (or press Enter 5x) | At most one visible flow; no error; note number of `/search` calls (fails today: 1 per press until input clears) | P2 | Edge | :700-704 |
| B-024 | Destination | any | 1) Explore "Ubud" 2) Within 1s Explore "Kuta" | Final view is Kuta only, no Ubud items | P2 | Edge | :433-483 (no cancel) |
| B-025 | Destination | region set | 1) Click Clear | Landing view; localStorage `drift_region` removed; sub-area chips vanish | P1 | UI | :606-609,419-424 |
| B-026 | Destination | region set and category "Food" selected | 1) Click Clear | Landing view; today a food grid of unscoped results shows under "For you" (fails today: D-B-17) | P1 | Edge | :606-609,439,866 |

### 3.3 Category filters

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-027 | Category | region Ubud | 1) Click "Food & drink" | aria-pressed true; request `category=food&region=Ubud&limit=20`; grid shows only food | P1 | UI | :804-816,446-455 |
| B-028 | Category | region Ubud | 1) Click each of Accommodation, Activities, Transport in turn | Each filters correctly; announcement "N results for X in Ubud" | P1 | UI | :460-465 |
| B-029 | Category | region with no transport | 1) Click Transport | "Nothing found in X yet. Try a different category..." | P1 | Edge | :873-878 |
| B-030 | Category | category active | 1) Click "All" | Section rows return | P1 | UI | :941-990 |
| B-031 | Category | sections visible | 1) Click "See all →" in Accommodation | Equals chip Accommodation | P1 | UI | :963-968 |
| B-032 | Category | region with sub-areas (Bangkok) | 1) Pick sub-area 2) Pick Food | Request has both `category` and `sub_area` | P1 | UI | :446-450 |
| B-033 | Category | category Food | 1) Explore another destination | Category persists; results food only for new region | P2 | UI | :433-479 |
| B-034 | Category | region | 1) Click Food, Activities, Food, Transport within 1s | Final grid equals last click (fails if a stale response lands last: D-B-18) | P2 | Edge | :433-483 |
| B-035 | Category | T2 (no preferences) | 1) Load region view | "✦ Ranked by your preferences" should not show (fails today: D-B-23) | P3 | UI | recommendations.ts:32; :854 |

### 3.4 Sub-area filters

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-036 | Sub-area | region Bangkok | 1) Explore Bangkok | "All Bangkok" plus 2 or more sub-area chips shown | P1 | UI | :824-852 |
| B-037 | Sub-area | region with 0 or 1 sub-areas | 1) Explore it | No sub-area row | P2 | UI | :824 |
| B-038 | Sub-area | Bangkok | 1) Click a chip | Results filtered; sections refetch with `sub_area` | P1 | UI | :449,532 |
| B-039 | Sub-area | chip selected | 1) Click same chip | Deselects, returns to all | P2 | UI | :845 |
| B-040 | Sub-area | chip selected | 1) Explore another destination | subArea reset to "" (watch that no request carries the old slug) | P1 | Edge | :419-421 |
| B-041 | Sub-area | chip with few places plus category | 1) Choose it and a category | Empty state message | P2 | Edge | :873-878 |

### 3.5 Local text filter ("Filter these results...")

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-042 | Filter | region Ubud, category All | 1) Type "cafe" | Sections replaced by flat grid of matches among the loaded 20 | P1 | UI | :661-668,866 |
| B-043 | Filter | a known place not in first 20 mixed results | 1) Type its exact name | Should be found (server search); today not found (fails today: D-B-6) | P1 | Edge | :455,661 |
| B-044 | Filter | category Food with more than 20 items | 1) Type text | "Load more" hidden while text present; reappears when cleared | P2 | UI | :898 |
| B-045 | Filter | region | 1) Type "zzzz" | "Nothing found in X yet..." | P2 | Edge | :873-878 |

### 3.6 Cards and badges

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-046 | Card | region Ubud | 1) Inspect a card | Category, name, region, meta row "tag · $$", stars with count, 100-char description with "...", up to 3 extra tags | P1 | UI | :119-169 |
| B-047 | Card | place with no rating, description, tags, photos | 1) Inspect | No crash; letter fallback tile | P2 | Edge | :100-104,140,155,161 |
| B-048 | Card | region Nusa Penida | 1) Find operator cards | "✓ Verified" badge on the 2 operators | P1 | UI | :121-123 |
| B-049 | Card | admin approves a claim (after fix) | 1) Reload region | "Claimed" badge on place; today unreachable (fails today: D-B-1, D-B-2, D-B-15) | P1 | UI | :130-132 |
| B-050 | Card | operator with trust tier | 1) Reload | "◆ Elite" or "★ Trusted" shown; today never rendered (fails today: D-B-15) | P2 | UI | :124-129 |
| B-051 | Card | 5 or more saves+books on a place | 1) Inspect card and detail | "♥ N saved" and "✓ N booked"; hidden below 5; aria-label present | P2 | UI | :30-50 |
| B-052 | Card | one user | 1) Click a partner CTA 5 times (tracked as "book") | "N booked" must not count clicks or repeat rows from one person (fails today: D-B-10) | P2 | Security | :211-222; services:407-408 |
| B-053 | Card | click a card | 1) Watch network | POST `/recommendations/interact` view returns 204; detail opens even if request fails | P1 | UI | :647-659 |
| B-054 | Card | keyboard | 1) Tab to card 2) Enter 3) Back, Space | Detail opens each time; no page scroll on Space | P2 | UI | :84-89 |

### 3.7 Save / unsave

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-055 | Save | T1, place card | 1) Click heart | POST `/recommendations/save` place; heart red; aria-pressed true; card not opened | P1 | UI | :106-116,632-645 |
| B-056 | Save | saved place | 1) Click heart again | `saved:false`; heart outline | P1 | UI | services:775-780 |
| B-057 | Save | place saved | 1) Switch to Trips tab 2) Return to Explore | Heart still red; today outline (fails today: D-B-8) | P1 | Edge | :405 |
| B-058 | Save | place saved earlier (5 saves exist in DB) | 1) Reload 2) Click heart on it | Should show as saved first; today this click UNSAVES and heart stays outline (fails today: D-B-8) | P1 | Edge | :405,632-645 |
| B-059 | Save | operator card | 1) Click heart | entity_type "operator" | P2 | UI | :634-637 |
| B-060 | Save | offline or 500 | 1) Click heart | Some error feedback; today silent, heart unchanged | P2 | Edge | :644 |
| B-061 | Save | any | 1) Double-click heart fast | Consistent final state; DB has 0 or 1 row | P2 | Edge | services:770-789 |
| B-062 | Save | keyboard | 1) Tab to heart 2) Press Enter | Saves; today opens the detail (fails today: D-B-16) | P2 | UI | :84-89 |
| B-063 | Save | any | 1) Save and unsave 10 times | "N saved" must not inflate (fails today: D-B-10) | P2 | Security | services:787 |
| B-064 | Save | web | 1) Look for a saved-items list | Should exist; none exists (fails today: D-B-5) | P2 | UI | recommendations.ts:91 |

### 3.8 Detail panel

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-065 | Detail | region view | 1) Click a place card | Close, photo, category, name, "region · address", rating, community row, description, all tags, Website, phone | P1 | UI | :279-355 |
| B-066 | Detail | scrolled list | 1) Click Close | Same list, same filters, scroll position kept | P2 | UI | :679-692 |
| B-067 | Detail | scrolled far down on desktop and mobile | 1) Open a card | Top of detail with Close button visible (same container element is reused so scrollTop may persist) | P2 | Runtime | :679-685,996 |
| B-068 | Detail | detail open | 1) Press browser Back | Should close detail; today leaves Explore or the app (fails today: D-B-22) | P2 | Edge | AppShell.web.tsx:41 |
| B-069 | Detail | place with website | 1) Click Website | New tab, rel noopener; hidden when no website | P2 | UI | :334-343 |
| B-070 | Detail | place with phone, phone viewport | 1) Tap the number | Should dial (tel link); today plain text | P3 | Mobile | :344 |
| B-071 | Detail | region Nusa Penida | 1) Open an operator | Verified badge; "Request booking" button shown | P1 | UI | :300-303,346-350 |
| B-072 | Detail | operator detail | 1) Click "Request booking" | Booking form or confirmation; today detail simply closes and nothing else happens (fails today: D-B-4) | P1 | UI | :347,685-688; AppShell.web.tsx:93 |
| B-073 | Detail | place detail | 1) Open a place | No "Request booking"; GET `/offers/place/:id` fires; nothing rendered if none | P2 | UI | :351 |
| B-074 | Detail | place with broken photo | 1) Open | Photo hidden, layout intact | P2 | Edge | :288-295 |
| B-075 | Detail | place with 5 stored photos | 1) Look for next/prev or thumbnails | Gallery expected; only photos[0] shown (fails today: D-B-5) | P2 | UI | :287-296 |
| B-076 | Detail | any | 1) Look for Share and Report | Controls expected; absent (fails today: D-B-5) | P2 | UI | :279-355 |
| B-077 | Detail | any | 1) Look for "Claim this listing" (as OP and as T1) | Absent; OP has no Explore tab (fails today: D-B-5) | P1 | UI | AppShell.web.tsx:68-73 |
| B-078 | Detail | any | 1) Look for reviews, "who's going", map, hours, save button | Absent (fails today: D-B-5) | P2 | UI | :279-355 |
| B-079 | Detail | spotlight place | 1) Open it 2) Open same place from region view | Compare fields; spotlight one is sparser (D-B-30) | P3 | UI | discovery.ts:166-194 |

### 3.9 Load more / pagination

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-080 | Load more | category Food, more than 20 results | 1) Click "Load more" | Request has `offset=20`; 20 more appended; announcement "N more results loaded" | P1 | UI | :489-513 |
| B-081 | Load more | continue | 1) Click until exhausted | Button disappears when `hasMore` false | P1 | UI | recommendations.ts:31 |
| B-082 | Load more | 500 on second page | 1) Click Load more | Some retry option; today button vanishes silently | P2 | Edge | :508-509 |
| B-083 | Load more | any | 1) Double-click "Load more" | One request (loadingMore guard); label "Loading more..." | P2 | Edge | :490,904 |
| B-084 | Load more | click Load more then chip | 1) Click Load more 2) Immediately switch category | No items from the old category in the new grid (fails today: D-B-18) | P2 | Edge | :489-513 |
| B-085 | Load more | All with filter text or no category | 1) Scroll to bottom | No Load more, no infinite scroll (document) | P3 | UI | :898 |

### 3.10 Booking offers

Prerequisite for B-105 to B-109: seed a viator place plus a `bookable_offers` row (none exist).

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-086 | Offers | seeded viator place, no operator match | 1) Open place | "Book via partner", "From AUD x", "Check availability" opens new tab; POST interact "book" | P1 | UI | :255-270 |
| B-087 | Offers | offer matched to operator | 1) Open place | "Claimed by operator", "Book direct · $0 commission", "Visit {name}"; no checkout URL anywhere | P1 | UI | :230-253; booking.ts:126-140 |
| B-088 | Offers | current prod data | 1) Open any place 2) Read `/offers/place/:id` | `{offers:[]}`, nothing rendered, no spinner, no rows created | P2 | API | booking.ts:149-157 |
| B-089 | Offers | current prod | 1) Explore a new city and look for a Viator tour | None can appear because the key is unset (D-B-14) | P1 | Edge | viator.ts:10 |
| B-090 | Offers | API | 1) GET `/offers/place/not-a-uuid` | Should be 400 or 404; today 500 | P3 | Validation | booking.ts:203-206 |
| B-091 | Offers | 500 from offers | 1) Open place | Section hidden, detail OK | P2 | Edge | :193-195 |

### 3.11 Operator claim flow (API only, no UI)

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-092 | Claim | OP with operator profile | 1) GET `/operators/search-places?q=ub` | 200 list; today 500 | P1 | API | operators.ts:85-121 |
| B-093 | Claim | OP | 1) POST `/operators/claims` `{place_cache_id:<uuid>,evidence:"I own this",contact_email:"a@b.co"}` | 201 with claimId; today 500 at the duplicate check | P1 | API | operators.ts:125-184 |
| B-094 | Claim | OP | 1) POST `/search/places/:id/claim` `{evidence}` | 201; today 500 | P1 | API | search.ts:130-199 |
| B-095 | Claim | OP | 1) POST with evidence of 9 chars 2) bad email 3) non-uuid id | 400 each | P2 | Validation | operators.ts:473-478 |
| B-096 | Claim | T1 and ANON | 1) POST claim | 403 for traveller, 401 for anon | P2 | Security | operators.ts:127 |
| B-097 | Claim | already claimed and duplicate pending | 1) POST twice | 409 messages | P2 | API | operators.ts:141-155 |
| B-098 | Claim | OP | 1) GET `/operators/claims` and `/search/claims` | List of own claims; today 500 | P2 | API | operators.ts:188; search.ts:202 |
| B-099 | Claim | AD and non-admin | 1) GET `/operators/claims/queue` | 200 for admin, 403 otherwise; today 500 for admin | P2 | API | operators.ts:303 |
| B-100 | Claim | AD | 1) PATCH `/operators/claims/:id` `{status:"approved"}` | Place linked, operator verified, trust score set, 200; today 500 | P1 | API | operators.ts:221-300 |
| B-101 | Claim | after approval | 1) Reload Explore for that region | Card and detail show Claimed or Verified; approval must set `is_claimed` | P1 | UI | operators.ts:257-260; :130 |
| B-102 | Claim | AD | 1) PATCH with `{status:"rejected"}` then again | 200 then 409 "already reviewed" | P2 | API | operators.ts:240-242 |
| B-103 | Claim | OP A | 1) PATCH `/operators/:id` of OP B | 404 "not yours" | P2 | Security | operators.ts:422-428 |

### 3.12 Reviews (API only, no UI)

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-104 | Reviews | T1 with completed booking | 1) POST `/reviews` `{booking_id,rating:5,title:"Great",body:"Really lovely stay"}` | 201; today 500 (`title` column) | P1 | API | reviews.ts:59-73 |
| B-105 | Reviews | T1 | 1) Try rating 0 and 6, body of 5 chars, non-completed booking, unknown booking, second review, operator role | 400, 400, 400, 404, 409, 403 | P2 | Validation | reviews.ts:8-51 |
| B-106 | Reviews | any operator | 1) GET `/reviews/operator/:id` | `{stats,reviews}`; today 500 | P1 | API | reviews.ts:87-126 |
| B-107 | Reviews | T1 | 1) GET `/reviews/me` | Own reviews; today 500 | P2 | API | reviews.ts:130-148 |

### 3.13 Photos

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-108 | Photos | card with v1 ref | 1) Open network tab | `/api/v1/photos?ref=places/../photos/..` 200 image, Cache-Control 86400 | P1 | UI | :14-22; photos.ts:21-72 |
| B-109 | Photos | card with legacy ref (682 rows) | 1) Load 20 legacy-photo places | All images load; measure failure rate (legacy Places API may be disabled) | P1 | Runtime | googlePlaces.ts:324-340 |
| B-110 | Photos | old row with expired name | 1) Load | Server heals with fresh ref and image loads (only on Google 400) | P1 | Runtime | photos.ts:52-64 |
| B-111 | Photos | Google returns 404 or 403 | 1) Load | Image must fall back; today 502 and blank box (fails today: D-B-13, D-B-19) | P1 | Runtime | photos.ts:54,75; :97-99 |
| B-112 | Photos | place with no photos | 1) Inspect | Letter tile fallback | P2 | UI | :100-104 |
| B-113 | Photos | operator with URL image | 1) Load | Loads directly; broken URL hidden | P2 | UI | :14-22 |
| B-114 | Photos | API | 1) GET `/photos` no ref 2) `ref=../../x` 3) `ref=a b` | 400 each | P2 | Validation | photos.ts:24-31 |
| B-115 | Photos | ANON | 1) GET `/photos?ref=places/x/photos/y` 200 times | Each unique ref calls Google; add auth or signature (D-B-28) | P2 | Security | photos.ts:30-50 |
| B-116 | Photos | region view (32 cards) | 1) Explore 6 regions in 60s | No 429 images (300 per min shared bucket) (D-B-12) | P2 | Runtime | index.ts:53 |

### 3.14 Errors, network, session

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-117 | Errors | block `/recommendations` (500) | 1) Explore Ubud with category Food | Fallback `/operators` cards have names; today blank titles (fails today: D-B-9) | P1 | Edge | :466-475; operators.ts:30-35 |
| B-118 | Errors | block `/recommendations` and `/operators` | 1) Explore | Error message with retry; today "Nothing found in Ubud yet" (fails today: D-B-9) | P1 | Edge | :475,873-878 |
| B-119 | Errors | block 1 of 4 section calls | 1) Explore | Failed section missing silently; document | P3 | Edge | :535-536 |
| B-120 | Errors | Offline before load | 1) Load Explore | Landing with no data; no white screen | P2 | Edge | :550-572 |
| B-121 | Errors | Redis stopped (staging only) | 1) Explore as T1 | Recs still served or clear error; today 500 then bad fallback | P2 | Runtime | services:551-556 |
| B-122 | Errors | expired access token, valid refresh | 1) Click a heart | Refresh then retry; success | P2 | UI | api.web.ts:37-53 |
| B-123 | Errors | expired token and refresh fails | 1) Click a heart | Redirect to "/" (state lost) | P2 | Edge | api.web.ts:52-54 |
| B-124 | Errors | expired access token | 1) Reload Explore | `/recommendations` silently anonymous (no 401, no refresh) so ranking differs | P3 | Edge | authenticate.ts:53-77 |
| B-125 | Errors | 10s timeout | 1) Throttle `/recommendations` above 10s | Spinner ends, error shown; today falls to `/operators` | P2 | Edge | api.web.ts:22 |

### 3.15 Persistence, navigation, storage

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-126 | Persist | region set, category Food, text typed | 1) Refresh | Region restored; category, text, selected reset | P2 | Edge | :612-614 |
| B-127 | Persist | region set | 1) Go to Trips tab 2) Return | Region restored; saves, category and text reset | P2 | Edge | AppShell.web.tsx:153 |
| B-128 | Persist | localStorage blocked | 1) Load Explore | No crash; today `getItem` at :613 is unguarded | P3 | Edge | :613 |
| B-129 | Persist | set `drift_recent_destinations` to `[{}]` | 1) Load | No crash; today `r.toLowerCase` TypeError | P3 | Edge | :357-365,675 |
| B-130 | Persist | user A explores Ubud, signs out | 1) Sign in as user B | B must not inherit A's region or recents (fails today: D-B-31) | P3 | Security | authSlice.web.ts:57 |

### 3.16 Mobile, accessibility, location

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-131 | Mobile | 375x667 | 1) Open Explore with region, trips, subregions | Sticky header leaves at least half of viewport for content (D-B-26) | P2 | Mobile | :996-1004 |
| B-132 | Mobile | 320px wide | 1) Open region view | No horizontal page scroll; grid one column; section scroller swipes | P1 | Mobile | :1133-1136,1186 |
| B-133 | Mobile | 375px | 1) Tap hamburger 2) Tap Explore | Drawer closes and Explore loads | P2 | Mobile | AppShell.web.tsx:108-124,153 |
| B-134 | Mobile | tablet 768 | 1) Resize across 768 | Layout switches cleanly, state kept | P3 | Mobile | useIsMobile.web.ts:3-16 |
| B-135 | Mobile | touch | 1) Tap heart and chips | Tap targets are usable (chips 6x14 px padding) | P3 | Mobile | :1099-1108 |
| B-136 | A11y | keyboard only | 1) Tab through whole screen, open detail, close | Visible focus, logical order; nested button inside role=button noted | P2 | UI | :78-90 |
| B-137 | A11y | screen reader | 1) Change category | Announcement "N results for X in Y" | P3 | UI | :862 |
| B-138 | Location | browser location denied | 1) Use Explore fully | No prompt at all and no "near me"; nothing depends on location (record) | P3 | Edge | useTripMode.web.ts:53 |

### 3.17 Security and API contract

| ID | Area | Precondition | Steps | Expected | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| B-139 | API | ANON | 1) POST `/recommendations/save` and `/interact` | 401 | P2 | Security | recommendations.ts:42,69 |
| B-140 | API | T1 | 1) interact with bad `interaction_type`, bad `entity_type`, missing fields | 400 each | P2 | Validation | recommendations.ts:46-56 |
| B-141 | API | T1 | 1) interact with `entity_id:"x"` 2) save with `entity_id:"x"` | Should be 400; today 204 (silent) and 500 | P3 | Validation | services:759; recommendations.ts:81 |
| B-142 | API | any | 1) GET `/recommendations?limit=1000&offset=-5` | limit capped 50, offset 0 | P3 | Validation | recommendations.ts:13-14 |
| B-143 | API | any | 1) GET `/search?q=<201 chars>` 2) `limit=0` 3) `limit=51` | 400 each | P3 | Validation | search.ts:17-22 |
| B-144 | API | any | 1) region, sub_area, q = `' OR 1=1 --` | Parameterised, no error, no leak | P2 | Security | services:539-543 |
| B-145 | API | any | 1) GET `/operators?lat=x&lng=y&radius=z` | Should be 400; today 500 | P3 | Validation | operators.ts:63-71 |
| B-146 | API | any | 1) GET `/operators/not-a-uuid` | 404 or 400; today 500 | P3 | Validation | operators.ts:339 |
| B-147 | API | any | 1) Send 61 `/search/subregions` in 60s | 429 for the 61st; check whether one user throttles others (shared bucket) | P2 | Runtime | rateLimit.ts:28 |
| B-148 | API | two users on separate networks | 1) User A sends 300 requests in 1 min 2) User B loads Explore | B is not throttled (fails if all users share one IP bucket) | P2 | Runtime | index.ts:44,53 |

## 4. Suspected defects

Severity: 1 = exposed or required path completely non-functional; 2 = major impairment or missing capability; 3 = noticeable defect; 4 = minor.

| ID | Sev | What is wrong | Evidence | Confirmed |
|---|---|---|---|---|
| D-B-1 | 1 | Operator claim submission cannot work. Two routes insert into `listing_claims` using columns that are not in the live table (live: id, place_id, user_id, status, created_at) | operators.ts:148,167; search.ts:170,183; live `\d listing_claims`; schema.sql:204-213 shows the drift | Confirmed by code and schema |
| D-B-2 | 1 | Claim review, listing and queue all fail; approval additionally needs a missing DB function and a missing `places_cache.claimed_at`. Two competing approval implementations set different flags (operators.ts marks the operator `is_verified` and links `operator_id` but never sets `is_claimed`; search.ts sets `is_claimed`) | operators.ts:198-207,233-236,250,278,311,322-323; search.ts:212-216,245-248,262; `\df *trust*` returns 0 rows; live `\d places_cache` | Confirmed |
| D-B-3 | 1 | All review routes 500 because `reviews.title` does not exist. `dashboard.ts:99` has the same bug | reviews.ts:61,92,133; live `\d reviews` | Confirmed |
| D-B-4 | 1 | "Request booking" on operator items is a dead end: it closes the detail and calls `onSelectOperator`, which sets AppShell state that nothing renders. `detail` and `onClearDetail` are destructured but never used; no POST `/bookings` from web | ExploreScreen:347-349,367-371,685-688; AppShell.web.tsx:42,93; BookingsScreen only GETs | Confirmed |
| D-B-5 | 2 | Requested capabilities have no UI at all: claim this listing, write or read reviews, photo gallery, share, report, "who's going" on a place, contact operator, save from detail, saved-items list, map, hours. Operator role does not even get an Explore tab | DetailPanel :279-355; grep of web/src; AppShell.web.tsx:68-73; recommendations.ts:91 never called | Confirmed |
| D-B-6 | 2 | Text "search" is client-side only over at most 20 loaded items (mixed view) and cannot load more while text is typed. The backend supports `q` but the UI never sends it | ExploreScreen:455,661-668,898; search.ts:17 | Confirmed |
| D-B-7 | 2 | Typing in "Filter these results..." on the landing view shows "Finding places for you..." forever: `loading` starts true (:373) and `fetchResults` returns early without resetting it (:439-443) | ExploreScreen:373,439-443,866-872 | Confirmed |
| D-B-8 | 2 | Heart state is never hydrated: `saves` starts empty and `/recommendations/saved` is never called. Clicking a heart on an already saved place unsaves it while the heart stays outlined; state is lost on tab switch; no saved list | ExploreScreen:405,632-645; recommendations.ts:81; services:775-780 | Confirmed |
| D-B-9 | 2 | Errors are swallowed. A failed `/recommendations` falls back to `/operators` whose fields differ (`business_name`, `avg_rating`) so cards have blank names; if both fail the user sees "Nothing found in X yet" | ExploreScreen:466-475,873-878; operators.ts:30-35 | Confirmed |
| D-B-10 | 2 | Social proof is misleading and gameable: "booked" counts click-throughs (type "book" on link click), rows not distinct users, unsave never removes the "save" interaction, no uniqueness or rate limit | ExploreScreen:38-46,211-222; services:397-423,738-751,787 | Confirmed |
| D-B-11 | 2 | If the 20s warm-up fails or times out, region falls back to the typed text, while the backend keeps warming; typed "lisbon portugal" then does not match stored region "Lisbon" | ExploreScreen:584-591; searchCache.ts:379-381; recommendations svc:581-585 | Confirmed by code; timing needs runtime |
| D-B-12 | 2 | Possible single shared rate-limit bucket: `trust proxy 1` behind nginx behind a cloudflared tunnel may make every user look like one IP. Photos, search and auth attempts then share 300 per min, 60 per min and 10 per 15 min | index.ts:44,53,63; rateLimit.ts:2-40; nginx drift site; cloudflared running | Needs runtime check |
| D-B-13 | 2 | 682 catalog rows use legacy Google photo refs; the proxy only heals on a 400 and otherwise returns 502, and v1 names expire (most rows are older than 30 days). Blank photos are likely for a large share of cards | photos.ts:52-64,75; googlePlaces.ts:324-340; live photo ref counts | Needs runtime check |
| D-B-14 | 2 | Viator and Foursquare keys are unset in the backend container and `bookable_offers` has 0 rows, so the booking-offer feature cannot show anything. Foursquare v3 endpoint may also be deprecated | viator.ts:10; foursquare.ts:147,172; live counts | Confirmed for keys; endpoint needs runtime |
| D-B-15 | 2 | Trust badges never render: `trust_tier` is not returned by any Explore endpoint; places hard-code `is_verified=false`; approved claims never set `is_claimed`. Effectively only the 2 operators can show a badge | ExploreScreen:124-132; services:594,656-682; operators.ts:257-260 | Confirmed |
| D-B-16 | 3 | Enter on the save heart bubbles to the card's keydown, which preventDefaults and opens the detail; keyboard users cannot save | ExploreScreen:84-89,106-116 | Confirmed by code; browser behaviour needs runtime |
| D-B-17 | 3 | Clear keeps the category. With category set and no region, `fetchResults` runs the unscoped query the redesign meant to avoid, under the "For you" header with disabled chips | ExploreScreen:439,606-609,809-812 | Confirmed |
| D-B-18 | 3 | Race conditions: `fetchResults` has no cancel, `loadMore` has no category guard, so stale responses can overwrite or mix categories | ExploreScreen:433-483,489-513 | Needs runtime check |
| D-B-19 | 3 | A failed photo hides the image and leaves a blank tile instead of the letter fallback | ExploreScreen:93-99,288-295 | Confirmed |
| D-B-20 | 3 | Featured pills can offer misspelled or partial regions (`solarno`, `Nusa`, `Labuan`, `Gili`) because the catalog stores raw typed text | discovery.ts:31-53,113-137; live region counts | Confirmed |
| D-B-21 | 3 | Rec cache per user, category and region lasts 1h; the 4 section calls never send `refresh`, so re-exploring can show stale section pools | services:549-556,712; ExploreScreen:450-453,530-537 | Needs runtime check |
| D-B-22 | 3 | No URL or history for detail, region or category: Back, refresh and deep links lose state; detail may open scrolled since the same container is reused | ExploreScreen:406,679-692; AppShell.web.tsx:41 | Needs runtime check |
| D-B-23 | 3 | "Ranked by your preferences" shows for every signed-in user even without preferences; expired tokens silently give anonymous ranking | recommendations.ts:32; services:687-707; authenticate.ts:53-77 | Confirmed |
| D-B-24 | 3 | Unresolvable destination gets no feedback and is saved to recents and localStorage | ExploreScreen:592-600; discovery.ts:32-37 | Confirmed |
| D-B-25 | 3 | No sort, price, rating, radius, near-me, map/list toggle or location prompt exists; `/operators` lat, lng and radius support is unused | ExploreScreen (no code); search.ts:15-24; operators.ts:63-71 | Confirmed (gap) |
| D-B-26 | 3 | Sticky header holds form, pills, filter input, two chip rows and note; likely fills much of a 375px phone screen | ExploreScreen:996-1004,696-857 | Needs runtime check |
| D-B-27 | 3 | Viator prices go stale: re-sync only bumps timestamps, and `upsertPlaces` `DO UPDATE` refreshes only name, rating, photos (not raw_data, website, description) | booking.ts:166; searchCache.ts:127-134 | Confirmed |
| D-B-28 | 3 | Public photo proxy lets anyone burn Google quota with arbitrary `places/x/photos/y` refs; the legacy path does a full-table `LIKE` on `photos::text` | photos.ts:13,30-50 | Confirmed |
| D-B-29 | 3 | Auto-explore on mount fires a live Google fan-out without any click | ExploreScreen:624-626 | Confirmed |
| D-B-30 | 4 | Spotlight items lack description, website, phone, address, community, so DetailPanel differs by entry point | discovery.ts:166-194 | Confirmed |
| D-B-31 | 4 | localStorage keys are not user-scoped and are not cleared on sign-out; `getItem` unguarded (:613); recents parse unvalidated (:361) | authSlice.web.ts:57; ExploreScreen:361,593,599,613 | Confirmed |
| D-B-32 | 4 | Minor: non-uuid ids give 500 (offers, operators/:id, search/places/:id, save); interact swallows bad ids with 204; `recordQuery` ON CONFLICT never fires for NULL category so rows pile up; `redis.keys` per interaction; discover aggregates are uncached and run twice per landing load; invalid inline `!important` style; each region change triggers 6 requests (results, 4 sections, subregions) | booking.ts:203; operators.ts:339; searchCache.ts:146-149,510; services:755; discovery.ts:38; ExploreScreen:1053 | Confirmed |

Counts: 40 controls (C-01 to C-40), 148 test cases (B-001 to B-148), 32 defects: Sev1 = 4, Sev2 = 11, Sev3 = 13, Sev4 = 4.
