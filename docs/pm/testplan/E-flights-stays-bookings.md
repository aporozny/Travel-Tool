# E. Flights, Stays, Bookings, Notifications, Currency: inventory, contract check, test cases, defects

Scope: Drift web (React 18.3.1, inline styles, axios base `/api/v1`, 10 s default timeout) and backend (Express/zod). Read-only review; nothing was called live, deployed or modified. Repo root on VPS: `/home/andre/projects/drift`.

Abbreviations for files: **F** = web/src/screens/FlightsScreen.web.tsx, **S** = StaysScreen.web.tsx, **T** = TripgicCheckout.web.tsx, **TB** = TravelBookings.web.tsx, **TU** = TripUpdates.web.tsx, **B** = BookingsScreen.web.tsx, **CU** = web/src/services/currency.web.tsx, **UC** = UnderConstructionScreen.web.tsx. Backend: **rf** = routes/flights.ts, **rs** = routes/stays.ts, **rt** = routes/tripgic.ts, **rb** = routes/bookings.ts, **rn** = routes/notifications.ts, **rc** = routes/currencies.ts, **sf** = services/flights.ts, **stb** = services/tripgicBooking.ts, **stf** = services/tripgicFlights.ts, **sts** = services/tripgicStays.ts, **stn** = services/tripNotifications.ts, **fx** = services/fx.ts.

Environment facts verified read-only on the VPS (container `traveller-backend`): `TRIPGIC_PAYMENT_MODE=sandbox`, `NOTIFICATIONS_TEST_TRIPS=true`, `DUFFEL_API_KEY` starts with `duffel_test_`, Travelport vars present, `TRIPGIC_PARTNER_ID` present. Users: 13 traveler, 4 operator, 2 admin. `tripgic_orders`: 12 flight rows `held`, 1 flight `expired`, 0 hotel. `flight_orders`: 3 `confirmed` (Duffel test). Nothing has ever reached `ticketed` or `confirmed` on TripGic.

Legend for "Confirmed": **CODE** = proven by reading code on both sides; **RUNTIME** = plausible from code but needs a browser or live call.

Test accounts used in cases: **ADMIN** (role admin, so `/tripgic/status` returns `bookingEnabled:true`), **TRAV** (role traveler), **OPER** (role operator).
Reusable data: SYD to DPS, depart 2026-11-15, return 2026-11-25; hotel "Bali", 2026-11-15 to 2026-11-18, 2 adults, 1 room. Passenger PAX1: Mr, Male, Jane Citizen (any name), DOB 1990-05-14, passport N1234567, country AU, expiry 2031-01-01. Contact: tester@example.com, ISD 61, phone 412345678.

---

## 1) Screen and control inventory

Mounting (AppShell.web.tsx:70-95): traveller and admin nav = Flights, Stays, Bookings (and others); operator nav = Dashboard, Bookings, Profile only (operators cannot reach Flights or Stays). `UnderConstructionScreen` is not imported anywhere (dead component).

| # | Control | File:line | Does what | API call |
|---|---|---|---|---|
| 1 | Page load: Duffel bookings list | F:397-401 | Loads "Your bookings" | GET /flights/orders, reads orders[].id, bookingReference, status, priceChargedAmount, priceChargedCurrency, slices |
| 2 | Page load: booking-enabled flag | T:27-37 (used F:379, S:69) | Decides whether Book buttons exist | GET /tripgic/status, reads bookingEnabled |
| 3 | Page load: TripGic orders list | T:448-449 (F:726) | "Your flight bookings" | GET /tripgic/orders, reads orders[] filtered by product |
| 4 | Round trip button | F:576-582, handler F:403 | tripType=roundtrip | none |
| 5 | One way button | F:583-589, F:405 | tripType=oneway, clears returnDate, hides Return field | none |
| 6 | Mix and match button | F:590-597 | tripType=mix (keeps results on screen, F:403-406) | none |
| 7 | From input (3 chars, upper-cased) | F:602 | origin | none |
| 8 | To input | F:606 | destination | none |
| 9 | Departure date (min today) | F:610, F:415 | departureDate, clears returnDate if earlier | none |
| 10 | Return date (min departure) | F:612-616 | returnDate, hidden when one-way | none |
| 11 | Adults number (1-9 attr, parseInt or 1) | F:620 | adults | none |
| 12 | Cabin select (4 options) | F:624-629 | cabinClass | none |
| 13 | Search flights button | F:633, handler F:420-481 | Validates 3-letter codes, departure, return (mix only); round trip or one way = one call; mix = two parallel calls | POST /flights/search {origin, destination, departureDate, returnDate?, adults, cabinClass}; mix sends two bodies without returnDate; reads offers[] |
| 14 | Currency selector | F:636 (CU:144-160) | Sets display currency, persisted in localStorage `drift.currency` | none (rates from GET /currencies) |
| 15 | Offer card: provider tag, price, slices | F:507-532 | Read-only display | none |
| 16 | "Book this flight" (TripGic, admin only) | F:540-545 | Opens TripGic checkout | none until modal (see 34) |
| 17 | "Booking coming soon" (disabled) | F:547-553 | Shown for Travelport, and Duffel or TripGic for non-admin | none |
| 18 | "Book this flight" (Duffel, admin only) | F:554-560 | Opens Duffel CheckoutModal | none until modal |
| 19 | "Choose this flight" / "Chosen" (mix) | F:534-537 | Sets pickedOut or pickedBack | none |
| 20 | "Book both flights" | F:688, F:496-500 | Queues return, starts outbound | see 34 and 44 |
| 21 | "Book outbound only" | F:689, F:694 | startBooking(pickedOut) | see 34 or 44 |
| 22 | "Book return only" | F:690, F:695 | startBooking(pickedBack) | see 34 or 44 |
| 23 | Mix summary: total, disclosure | F:665-701 | sumPrices across currencies | none |
| 24 | Duffel modal: overlay click closes | F:290 | onClose (queue cleared) | none |
| 25 | Duffel modal: X | F:294 | onClose | none |
| 26 | Duffel modal: title select | F:305-310 | title | none |
| 27 | Duffel modal: gender select | F:311-314 | gender | none |
| 28 | Duffel modal: given name | F:317 | givenName | none |
| 29 | Duffel modal: family name | F:318 | familyName | none |
| 30 | Duffel modal: date of birth | F:321 | bornOn | none |
| 31 | Duffel modal: email | F:322 | email | none |
| 32 | Duffel modal: phone | F:324 | phoneNumber | none |
| 33 | Duffel modal: Continue to payment | F:327, F:235-247 | Enabled when all fields non-empty | POST /flights/payment-intents {offerId}; reads id, clientToken, amount, currency |
| 34 | Duffel modal: Stripe card number, expiry, CVC | F:179-187 | Stripe Elements iframes | Stripe only (client_secret decoded from clientToken, F:111-114) |
| 35 | Duffel modal: Pay | F:189, F:142-174 | stripe.confirmCardPayment then onSuccess | Stripe; then POST /flights/payment-intents/confirm {paymentIntentId}, then POST /flights/orders {offerId, paymentIntentId, passengers[{id,title,gender,givenName,familyName,bornOn,email,phoneNumber}]} (F:249-274); reads bookingReference |
| 36 | Duffel "Booked!" banner | F:642-646 | Shows confirmation code | none |
| 37 | Duffel "Your bookings" list | F:736-754 | Read-only | see 1 |
| 38 | TripGic flight modal: auto quote on open | T:202-212 | Confirms fare | POST /tripgic/flights/quote {offerId}; reads quoteId, title, totalAmount, currency, priceChanged, previousAmount, adultCount, docRequired, paymentMode |
| 39 | TripGic modal: overlay click / X | T:88, T:92 | onClose | none |
| 40 | Passenger: title and gender selects | T:110, T:113 | title, gender | none |
| 41 | Passenger: given and family name | T:118-119 | names | none |
| 42 | Passenger: date of birth | T:261 | bornOn | none |
| 43 | Passenger: passport number, country (2 letters), expiry | T:266-270 (only if docRequired) | passport | none |
| 44 | Contact: email, ISD, mobile | T:129-132 | contact (digits only for ISD and phone) | none |
| 45 | "I accept the new price" checkbox | T:276-278 | acceptPrice | none |
| 46 | "Book -- price" button | T:279-281, T:217-243 | Places order | POST /tripgic/flights/orders {quoteId, passengers[], contact{email,isdCode,phoneNumber}, acceptPriceChange?}; reads OrderView |
| 47 | Order result panel + Done | T:155-175 | Shows Tickets issued or Reserved; Done calls onClose | none |
| 48 | Hotel modal: rooms on open | T:324-330 | Loads rooms | POST /tripgic/hotels/rooms {hotelId, checkInDate, checkOutDate, rooms, adults}; reads rooms[], trackingId |
| 49 | Hotel modal: Select (per room) | T:401, T:332-344 | Quote a room | POST /tripgic/hotels/quote {trackingId, roomTrackingId}; reads QuoteView |
| 50 | Hotel modal: guest title, gender, names | T:416-421 (PersonFields) | guests, one per adult | none |
| 51 | Hotel modal: contact | T:422 | contact | none |
| 52 | Hotel modal: special requests (200 chars) | T:423 | specialRequests | none |
| 53 | Hotel modal: accept price | T:424-426 | acceptPrice | none |
| 54 | Hotel modal: Book | T:427, T:348-371 | Places order | POST /tripgic/hotels/orders {quoteId, guests[], contact, specialRequests?, acceptPriceChange?} |
| 55 | Hotel modal: Choose a different room | T:430 | setQuote(null) | none |
| 56 | Hotel modal: overlay, X, Done | T:88, T:92, T:172 | close | none |
| 57 | Cancel booking (per held order) | T:480-482, T:451-462 | Cancels reservation | POST /tripgic/orders/:id/cancel {} then GET /tripgic/orders |
| 58 | Stays: destination | S:151 | destination | none |
| 59 | Stays: check-in (min today) | S:155, S:81 | checkInDate, clears check-out if <= | none |
| 60 | Stays: check-out (min check-in) | S:159 | checkOutDate | none |
| 61 | Stays: rooms (1-8) | S:163 | rooms | none |
| 62 | Stays: adults (1-16) | S:167 | adults | none |
| 63 | Search stays button | S:171, S:110-135 | Starts fast search plus background TripGic search | POST /stays/search {destination, checkInDate, checkOutDate, rooms, adults}; reads results[]; and POST /stays/tripgic-search (same body) reads status, searchId, results |
| 64 | Polling banner (automatic) | S:86-108, S:181-187 | Polls every 3 s up to 150 s | GET /stays/tripgic-search/:searchId, reads status ('pending','unknown','ready','failed'), results |
| 65 | Stays: currency selector | S:174 | as 14 | none |
| 66 | Stay card: photo (hides on error), name, provider tag, price, amenities | S:196-233 | Display | none |
| 67 | "View rooms and book" (TripGic, admin, after a search) | S:218-220 | Opens hotel modal | see 48 |
| 68 | Hotel bookings list | S:245 (T:443-487) | Read-only plus Cancel | GET /tripgic/orders |
| 69 | Bookings: load operator/traveller bookings | B:20-25 | Lists Local experiences | GET /bookings, reads array: id, business_name, status, start_date, end_date, guests, total_amount, currency |
| 70 | Trip updates: load | TU:126-130 | List and prefs | GET /notifications (notifications[], unread) and GET /notifications/preferences (emailEnabled, inAppEnabled) |
| 71 | Trip updates: "Mark all read" (only when unread>0) | TU:160, TU:132 | Marks read | POST /notifications/read-all then reload |
| 72 | "Reminder settings" / "Hide settings" | TU:161 | Toggles panel | none |
| 73 | "Email me trip reminders" checkbox | TU:168, TU:136-151 | Optimistic toggle, rollback on error | PUT /notifications/preferences {emailEnabled} |
| 74 | "Show reminders here in Drift" checkbox | TU:172 | Optimistic toggle | PUT /notifications/preferences {inAppEnabled} |
| 75 | Flights and stays cards (read-only) | TB:186-246 | Legs, refs, reminders, status | GET /tripgic/orders, GET /flights/orders, GET /notifications/schedule (reads items[].type, sendAt, status, source, orderId) |
| 76 | Empty state "No bookings yet" | B:36-41 | Only when bookings=[] and travelCount===0 | none |
| 77 | Unsubscribe page (email link) | rn:33-39 | GET shows confirm page, changes nothing | GET /notifications/unsubscribe?token= |
| 78 | "Stop trip emails" button | rn:38, rn:41-60 | Turns email off, skips pending emails, records consent | POST /notifications/unsubscribe?token= |
| 79 | Currency select (component) | CU:150-157 | setCurrency, localStorage, notify all Price components | none (data from GET /currencies, CU:32) |
| 80 | Currency table load | CU:30-38 | Rates, list, default | GET /currencies (public), reads currencies, default, available, rateDate, rates |
| 81 | Backend-only, no UI control | tripgic GET /orders/:id (rt:186), POST /notifications/:id/read (rn:87), GET /stays/:id/rates (rs:130), POST /notifications/admin/test-send, /admin/backfill, /admin/process (rn:169-208), PATCH /bookings/:id/status (used by DashboardScreen only) | | |

Count: 81 rows; 80 are UI or automatic controls, row 81 groups 6 API-only endpoints.

---

## 2) API contract check

| UI call | Backend route (file:line) | Match? | Problem |
|---|---|---|---|
| GET /tripgic/status | rt:50 | Yes | Returns bookingEnabled true only for admin AND TRIPGIC_PAYMENT_MODE=sandbox (rt:37-39). A failure silently leaves buttons hidden (T:33). |
| POST /flights/search | rf:64 | Yes, weak validation | zod: origin and destination `length(3)` only, no A-Z check (rf:44-45); dates only `date()` so past departure or return before departure pass (rf:46-47); adults max 9; unknown cabin rejected. ZodError becomes `{message:"Validation error"}` (rf:97), which is all the UI shows (F:473). Duffel rejection aborts the whole call and TripGic and Travelport results are discarded (rf:73). |
| GET /flights/orders | rf:205 | Yes | Fields match FlightOrderSummaryView (sf:408-416). |
| POST /flights/payment-intents {offerId} | rf:115 | Yes | Admin-only while Duffel key is test (rf:36-41): non-admin gets 503 "Flight booking is not yet available". Response id, clientToken, amount, currency present (sf:272-278). |
| POST /flights/payment-intents/confirm {paymentIntentId} | rf:142 | Yes | UI ignores the response body. |
| POST /flights/orders {offerId, paymentIntentId, passengers[]} | rf:178 | Fields match; timing hazard | passengerSchema requires valid email, phoneNumber min 6, bornOn date (rf:158-167); UI only checks non-empty (F:233). Runs AFTER the card is charged (F:254-255). Response `{id, bookingReference, status}` (sf:405). |
| POST /tripgic/flights/quote {offerId} | rt:85 | Yes | offerId `min(3).max(200)`; must contain ":" (stb:172). Rate limit 30 per 10 min shared with order and cancel (rt:24-30). All UI-read fields exist in QuoteView (stb:105-120). |
| POST /tripgic/flights/orders | rt:116 | Yes | Body matches flightOrderSchema (rt:94-113). passportNumber regex 5-20 alnum; UI strips non-alnum but has no max length. Wrong passenger count gives 400 `passenger_count` (stb:558). `price_changed` 409 only when quote.priceChanged and not accepted (stb:538-545); the UI cannot send that state (button disabled, T:215), so the T:236 branch is effectively unreachable. |
| POST /tripgic/hotels/rooms | rt:137 | Yes | Empty result returns `{trackingId:"", rooms:[]}` (stb:265). |
| POST /tripgic/hotels/quote {trackingId, roomTrackingId} | rt:146 | Yes, regex risk | trackingId `^[A-Za-z0-9]{8,64}$`, roomTrackingId `^[A-Za-z0-9#_.-]{8,120}$` (rt:149). A live room id containing another character would 400 (RUNTIME). |
| POST /tripgic/hotels/orders | rt:166 | Yes | guests max 16, age optional (UI omits, backend uses 30, stb:387, 690). |
| GET /tripgic/orders | rt:178 | Yes | Marks expired holds as a side effect (stb:762-767). Does NOT re-sync with TripGic. |
| POST /tripgic/orders/:id/cancel | rt:194 | Yes | Admin-only (requireBookingAccess). Sandbox refuses API cancels, so always 502 `cancel_failed` (stb:829-835). UUID validated (stb:818). |
| POST /stays/search | rs:48 | Yes | Both Duffel and Travelport tolerated; only errors if both fail (rs:71-73). checkOut > checkIn is not enforced server-side. Duffel Stays 403 gives a 422 with a generic message. |
| POST /stays/tripgic-search | rs:96 | Yes | Returns `{searchId, status, results?}` (rs:99-101). |
| GET /stays/tripgic-search/:searchId | rs:117 | Yes | searchId must be 16 hex chars, else 400 (rs:119). |
| GET /currencies | rc:156, mounted index.ts:80 | Yes | Public, `Cache-Control public max-age=900`. UI Table interface matches (CU:15). |
| GET /bookings | rb:93 | Partial | Traveller rows include business_name (rb:101). OPERATOR rows do not (rb:111-113: first_name, last_name, traveler_email only) but B:48 renders `b.business_name` (blank name). ADMIN role gets 403 (rb:123), swallowed by `.catch(console.error)` (B:23). |
| GET /notifications | rn:64 | Yes | LIMIT 30, `unread` counts only those 30 (rn:67, 70). `link` returned, never used by UI. |
| GET/PUT /notifications/preferences | rn:100, rn:113 | Yes | PUT accepts partial booleans. |
| POST /notifications/read-all | rn:77 | Yes | Registered before `/:id/read` (rn:87), no route shadowing. |
| GET /notifications/schedule | rn:139 | Yes | Email rows only; UI reads type, sendAt, status, source, orderId. |
| GET/POST /notifications/unsubscribe | rn:33, rn:41 | Yes | Public, HMAC token, no expiry (notificationTokens.ts:21-41). |
| Unused: GET /tripgic/orders/:id | rt:186 | n/a | The only place `syncOrderFromTripgic` runs (stb:780-815, 810-815); no web caller (grep of web/src). Held orders never refresh. |
| Unused: POST /notifications/:id/read, GET /stays/:id/rates | rn:87, rs:130 | n/a | No UI control. |
| SQL columns | tripgic_orders, flight_orders, flight_order_passengers, in_app_notifications, notification_preferences, scheduled_notifications, trip_segments, bookings | Yes | Every column in the INSERT and SELECT statements exists in the live tables (\d checked). `flight_order_passengers.traveler_id` is nullable, so the Duffel order insert (sf:396-401) is valid. `tripgic_orders.status` CHECK allows held, ticketed, confirmed, cancelled, expired, failed only. |

Acceptance-plan overlap (docs/pm): TEST-AND-ACCEPTANCE-PLAN-TRIPGIC.md items A-01..A-12, F-01..F-22, H-01..H-15, O-01..O-08, R-01..R-09; TRIP-REMINDERS-ACCEPTANCE.md R-1..R-9. Each case below lists "Extends" or "New" in the Source column.
Not covered by either existing plan, so entirely new here: mix and match (all of E-026..E-042), Duffel Stripe checkout, currency selector, unsubscribe edge cases, search input validation, mobile 375 px specifics, stale-state defects.

---

## 3) Test cases

Priority: P1 = release blocker, P2 = important, P3 = nice to have. Type: UI, API, Validation, Edge, Mobile, Security. "Extends X" means the case deepens an existing acceptance item X; "New" means no existing item.

### 3.1 Flight search form and validation

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-001 | Flights search one-way | ADMIN logged in, Flights tab | 1) Click "One way". 2) From = SYD, To = DPS. 3) Departure 2026-11-15. 4) Adults 1, Cabin Economy. 5) Click "Search flights" | Return field is hidden; button shows "Searching..." then results sorted cheapest first (by EUR value); tags "via Duffel" and "via TripGic"; request body has no returnDate | P1 | UI | F:403-406, F:456-463; extends F-01, F-03 |
| E-002 | Flights round trip | as E-001 | 1) Click "Round trip". 2) SYD, DPS, depart 2026-11-15, return 2026-11-25. 3) Search | Each card shows two slice rows (SYD to DPS and DPS to SYD); return date min equals departure date | P1 | UI | F:612-616; extends F-02 |
| E-003 | Round trip without return date | as E-001 | 1) Round trip selected. 2) SYD, DPS, depart 2026-11-15, leave Return empty. 3) Search | Currently runs a ONE-WAY search with no warning (F:460 sends returnDate undefined). Expected by user intent: prompt for return date. Record actual | P2 | Edge | F:426, F:460; defect D-E-7 |
| E-004 | Mix and match search | as E-001 | 1) Click "Mix and match". 2) SYD, DPS, 2026-11-15, return 2026-11-25. 3) Search | Two headings "1. Choose your outbound flight" and "2. Choose your return flight"; two POSTs made, second with origin DPS destination SYD departureDate 2026-11-25 | P1 | UI | F:434-447, F:652-663 |
| E-005 | Mix requires return date | as E-001 | 1) Mix and match. 2) Fill all but Return. 3) Search | Error "Pick a return date." and no request sent | P2 | Validation | F:426 |
| E-006 | Origin too short | as E-001 | 1) From = "SY". 2) To = DPS. 3) Date 2026-11-15. 4) Search | Error "Enter valid 3-letter airport codes (e.g. SYD, LHR)."; no request | P2 | Validation | F:421-424 |
| E-007 | Non-letter codes | as E-001 | 1) From "123", To "!!!", date 2026-11-15. 2) Search | UI accepts (length 3 only); backend accepts (no regex, rf:44-45); Duffel returns 422 message or empty. Record what the user sees; expected: a clear "not a valid airport code" message | P2 | Validation | F:421, rf:44-45; defect D-E-9 |
| E-008 | Same origin and destination | as E-001 | 1) From SYD, To SYD, 2026-11-15. 2) Search | Nothing blocks it client-side or in zod; expect a friendly error, record actual | P3 | Edge | F:421-425, rf:43-50; D-E-9 |
| E-009 | Missing departure date | as E-001 | 1) SYD, DPS, no date. 2) Search | Error "Pick a departure date." | P2 | Validation | F:425 |
| E-010 | Past departure date via typing | as E-001 | 1) Type 2020-01-01 into Departure (min attribute does not block typing). 2) Search | Backend zod accepts; Duffel error message or empty list shown; no crash. Record message | P2 | Validation | F:610, rf:46 |
| E-011 | Return before departure via typing | as E-001 | 1) Depart 2026-11-25. 2) Type return 2026-11-15. 3) Round trip search | Backend accepts (no cross-field check, rf:46-47); expect friendly error; record actual | P2 | Validation | F:615, rf:46-47; D-E-9 |
| E-012 | Adults boundaries | as E-001 | 1) Adults 0 (or empty). 2) Adults 9. 3) Type 12. 4) Search each | 0 or empty becomes 1; 9 accepted; 12 sends adults:12 and API returns 400 "Validation error" shown as-is | P2 | Validation | F:620, rf:48 |
| E-013 | Adults 2 pricing | as E-001 | 1) Adults 2, SYD to DPS one-way. 2) Search | Two passenger blocks later in checkout; price is all-passenger total (stf comment) | P2 | UI | F:620, stf:127 |
| E-014 | Cabin values | as E-001 | 1) Search once per cabin: Economy, Premium economy, Business, First | All four accepted (no 400); business or first may return fewer or no offers | P2 | UI | F:624-629, rf:49, stf:57-62 |
| E-015 | Slow search timeout | as E-001 | 1) Throttle network so search exceeds 30 s | After 30 s error "Search is taking longer than usual -- please try again."; spinner clears; button re-enabled | P2 | Edge | F:470-471 |
| E-016 | No route (no results) | as E-001 | 1) Search a route with no inventory (for example SYD to a tiny airport) | "No flights found for that search."; no red banner; TripGic "no flights available" maps to empty (stf:167) | P2 | Edge | F:648-650, stf:167; extends F-04 |

### 3.2 Flight results

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-017 | Provider tags | Search SYD to DPS one-way 2026-11-15 as ADMIN | 1) Inspect each card header | Each card shows "via Duffel", "via TripGic" or "via Travelport" and an airline logo when available | P2 | UI | F:512, F:68-72; extends F-01 |
| E-018 | Sort order across currencies | Result list contains AUD (Duffel) and USD (TripGic) fares | 1) Convert each price to EUR manually with `/currencies` rates. 2) Compare to list order | Ascending by EUR value, not raw number (rf:86-93) | P1 | UI | rf:91-93; extends F-03 |
| E-019 | Slice display | Any offer | 1) Read a card | Times in 12-hour format, airport codes, duration "Xh Ym", "Nonstop" or "N stop(s)" | P2 | UI | F:93-101, F:516-532 |
| E-020 | Provider partial failure | Owner blocks TripGic | 1) Search | Duffel results still shown, no error banner | P1 | Edge | rf:81-85; extends F-05 |
| E-021 | Duffel failure hides everything | Owner blocks Duffel or a Duffel 422 (bad date) | 1) Search | Whole call fails: error banner, TripGic and Travelport results NOT shown (rf:73) | P2 | Edge | rf:73; defect D-E-10 |
| E-022 | Expired offer at checkout | Search then wait over 20 min, ADMIN | 1) Click Book on a Duffel offer | "This fare has expired -- please search again" (409) in the modal | P2 | Edge | sf:286-288, rf:125-127 |
| E-023 | Times are airport-local | Any offer | 1) Compare to airline site | Departure and arrival shown in each airport's local time with no timezone shift (strings have no offset) | P2 | UI | F:93-96, stf:83-88 |
| E-024 | Markup consistent | ADMIN, TripGic offer | 1) Note card price. 2) Open Book (quote step) | Quote total equals card price to the cent | P1 | UI | stf:133, stb:193; extends F-08, F-06 |
| E-025 | Disclosure copy | ADMIN and TRAV | 1) Read text under a TripGic card | ADMIN: "Fare shown includes Drift's booking fee. Test booking -- nobody is charged."; TRAV: "Shown for comparison" | P3 | UI | F:542, F:549 |

### 3.3 Mix and match

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-026 | Mix choose outbound | ADMIN, mix search done (E-004) | 1) Click "Choose this flight" on an outbound card | Card highlighted, button reads "✓ Chosen"; summary row "Outbound" shows airline, times, price | P1 | UI | F:535-537, F:668-670 |
| E-027 | Mix choose return | as E-026 | 1) Click "Choose this flight" on a return card | Summary "Return" row filled; total row appears | P1 | UI | F:674-681 |
| E-028 | Mix change choice | as E-026 | 1) Choose outbound A. 2) Choose outbound B | Only B is highlighted; summary updates | P2 | UI | F:657 |
| E-029 | Mix total, same currency | both picks AUD (or both USD) | 1) Choose both | Total shown as sum, with "≈ converted (original)" when a chosen currency differs | P2 | UI | F:681, CU:126-142 |
| E-030 | Mix total, mixed currency | one AUD and one USD pick, rates available | 1) Choose both | "≈ $X" in chosen currency (converted sum); with rates unavailable shows "see each price above" | P2 | UI | CU:134-141, F:681 |
| E-031 | Two-tickets disclosure | picks made | 1) Read paragraph | Text says two separate tickets booked and changed independently | P2 | UI | F:683-685 |
| E-032 | Book both, ADMIN, TripGic to TripGic | picks: TripGic outbound, TripGic return | 1) Click "Book both flights". 2) In modal fill PAX1 and contact. 3) Click "Book". 4) In result click "Done" | Modal 1 heading "Outbound flight: passenger details"; after Done the return flight modal should open with heading "Return flight: passenger details", pre-filled names, DOB, passport, contact, and a fresh fare quote. CURRENT CODE: the same modal instance persists so the first order result is shown again (defect D-E-1). Record actual | P1 | UI | F:496-500, F:711-724, T:193-212, T:249; D-E-1 |
| E-033 | Book both, Duffel to Duffel | picks: Duffel outbound and return, ADMIN | 1) Click "Book both flights". 2) Complete passengers, payment, Pay | Second modal starts at "Passenger details" for the return offer. CURRENT CODE: modal not keyed, step stays 'submitting' showing "Booking your flight..." forever, first confirmation banner erased (defect D-E-2). Record actual | P1 | UI | F:211, F:251, F:486-494, F:728-733; D-E-2 |
| E-034 | Book both, mixed providers | picks: TripGic outbound, Duffel return | 1) Book both. 2) Finish TripGic then Done | Duffel modal opens for return; carried passenger details are NOT offered to Duffel modal (feature only wired for TripGic, F:393, T:184) | P2 | UI | F:716, F:728 |
| E-035 | Book both, close without booking | ADMIN | 1) Book both. 2) Close first modal with X | Queue is dropped; return modal never opens | P2 | UI | F:717-720 |
| E-036 | Book outbound only | ADMIN | 1) Click "Book outbound only" | Only outbound modal opens; after booking and Done nothing else opens | P1 | UI | F:689, F:720 |
| E-037 | Book return only | ADMIN | 1) Click "Book return only" | Modal heading "Return flight: passenger details" | P2 | UI | F:690, F:502-503 |
| E-038 | Mix with a compare-only pick | ADMIN, picks include a Travelport offer | 1) Choose Travelport outbound and TripGic return | "Book both" absent; only "Book return only" plus note "Booking for one of these flights isn't available yet." | P2 | UI | F:686-698 |
| E-039 | Mix as TRAV | TRAV logged in | 1) Mix search and choose both | No Book buttons at all; note "Booking for these flights isn't available yet." | P1 | Security | F:693-697, F:483-484; extends A-02 |
| E-040 | Mix heading uses live inputs | mix results visible | 1) Change From to "MEL" without searching | Headings show "MEL → DPS" although results are for SYD (F:654 uses current state); record | P3 | Edge | F:654, F:659; D-E-8 |
| E-041 | Switching trip type keeps mix results | mix results visible | 1) Click "Round trip" | Mix results stay on screen and Book both remains usable while the form says Round trip (F:403-406 does not clear) | P3 | Edge | F:403-406; D-E-8 |
| E-042 | One leg search fails | Owner blocks Duffel or use return date that Duffel rejects | 1) Mix search | Promise.all: entire search fails with a single error, neither leg shown | P2 | Edge | F:437-440, F:467-477 |

### 3.4 TripGic flight checkout (ADMIN, sandbox)

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-043 | Open quote | ADMIN, TripGic offer on screen | 1) Click "Book this flight" | Modal, "Confirming this fare...", then route, dates, total with Price component and gold "Test booking -- no payment is taken" notice; one passenger block per adult | P1 | UI | T:202-212, T:248-254; extends F-07 |
| E-044 | Quote expired or fare gone | ADMIN | 1) Click Book on an old offer (over 10 min old, ask owner to force) | Red error "This fare is no longer available -- please search again" (409) and no form | P2 | Edge | stb:182-185, T:247 |
| E-045 | Submit disabled until valid | modal open | 1) Leave all blank; observe Book button. 2) Fill names only. 3) Add DOB. 4) Add passport (5+ chars, 2-letter country, expiry). 5) Add contact | Button opacity 0.5 and disabled until every step done; enabled after step 5 | P1 | Validation | T:214-215, T:279; extends F-09 |
| E-046 | Passport shown per docRequired | domestic vs international fare | 1) Open Book on an international fare (SYD to DPS). 2) Open one with docRequired no | International shows passport fields; if docRequired false fields hidden and not required | P2 | UI | T:263-272, stb:222 |
| E-047 | Passport field sanitising | modal open | 1) Type "N12-34 567" in Passport number. 2) Type "au1" in country | Number becomes "N1234567" (non-alnum stripped); country "AU" (letters only, upper-case, max 2) | P2 | Validation | T:266-267; extends F-10 |
| E-048 | Passport number too long or short | modal open | 1) Enter "N123" then "N1234567890123456789012" | 4 chars keeps button disabled; 22 chars enables the button but backend returns 400 "Validation error" (regex max 20, rt:104), shown in red | P3 | Validation | T:214, rt:104 |
| E-049 | Passport expiry sanity | modal open | 1) Enter expiry 2020-01-01 (expired) and DOB in the future 2030-01-01 | UI accepts both; backend zod accepts dates; TripGic decides (422 "The passenger details were not accepted: ..."). Record message; expected: client-side check | P2 | Validation | T:214, rt:103-106, stb:592-594; D-E-25 |
| E-050 | Email invalid | modal open | 1) Email "abc" | Book stays disabled (regex needs x@y.z) | P2 | Validation | T:138; extends F-11 |
| E-051 | Phone rules | modal open | 1) ISD field type "+61" | Only digits kept ("61"). 2) Mobile "abc" gives empty. 3) Mobile "1234" stays disabled (min 5). 4) 16 digits | Digits only; under 5 disabled; over 15 enables button but API 400 "Validation error" | P2 | Validation | T:131-132, T:138, rt:72-73 |
| E-052 | Successful reserve | valid PAX1 and contact | 1) Click "Book -- price" | Button shows "Booking..."; result panel "Reserved -- not finalised yet" (wallet empty), Booking ref (FL...), Airline reference (PNR), Total, "Test booking -- not charged", "Held until" date; "You can find this booking any time under Bookings" | P1 | UI | T:155-175, stb:632-643; extends F-12 |
| E-053 | Ticketed result (funded wallet) | wallet funded (BLOCKED-W) | 1) Book | "Tickets issued" green panel, status Ticketed | P1 | UI | T:160, stb:644-646; extends F-20 |
| E-054 | Double submit | modal open, valid | 1) Double-click Book quickly | Button disabled after first click; only one row in `tripgic_orders` for that quote (unique idx_tripgic_orders_quote); same order returned | P1 | Edge | T:215, stb:555-556, 568-569; extends F-13 |
| E-055 | Two passengers | search Adults 2, book a TripGic fare | 1) Open Book | Two passenger blocks; both must be complete; mismatch count sent directly gives 400 passenger_count | P2 | UI | T:256, stb:558; extends F-14 |
| E-056 | Price-changed banner | needs owner simulation of price move | 1) Open Book on a fare whose validate price differs from search price | Red "Price changed from X" bar and "I accept the new price" checkbox; Book disabled until ticked | P2 | UI | T:148-150, T:276-278, T:215; extends F-17 |
| E-057 | Price change acceptance carries over | Book both TripGic sequence or reopen | 1) Tick accept on fare 1. 2) Open fare 2 with priceChanged | Checkbox may already be ticked (acceptPrice never reset, T:197); record | P3 | Edge | T:197; D-E-11 |
| E-058 | Overlay click during submit | valid form | 1) Click Book. 2) Immediately click the dark overlay | Modal closes without confirmation; booking still completes server-side and appears in Your flight bookings after refresh; no result shown to user | P2 | Edge | T:88, T:217-243; D-E-29 |
| E-059 | Lock and quote scoping | two ADMIN users if available | 1) Copy quoteId from network tab of user A. 2) Post it as user B | 410 "This price has expired", indistinguishable from unknown | P2 | Security | stb:154-162; extends A-07 |
| E-060 | Return fare title | round trip TripGic fare | 1) Book | Title reads "SYD to DPS and back, 2026-11-15 / 2026-11-25"; both legs appear in Bookings | P2 | UI | stb:199-200; extends F-15 |

### 3.5 Duffel checkout (ADMIN, test key)

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-061 | Open Duffel checkout | ADMIN, Duffel offer | 1) Click "Book this flight" on a Duffel card | "Passenger details" modal with one block per adult | P1 | UI | F:554-560, F:301-326; extends A-06 |
| E-062 | Continue disabled until filled | modal open | 1) Fill all but phone. 2) Fill phone | Button disabled then enabled; label "Continue to payment -- $X CUR" | P2 | Validation | F:233, F:327-329 |
| E-063 | Payment intent | valid passenger | 1) Click "Continue to payment" | POST /flights/payment-intents; "Payment" heading; "Charging $amount CUR"; Stripe fields render (card number, expiry, CVC) | P1 | UI | F:235-247, F:333-344 |
| E-064 | Test card success | Stripe test card 4242 4242 4242 4242, any future expiry, CVC 123 | 1) Enter card. 2) Click "Pay" | "Charging..." then "Booking your flight..." then modal closes and green "Booked! Your confirmation code is XXXXXX"; row appears in "Your bookings" | P1 | UI | F:142-174, F:249-274 |
| E-065 | Declined card | Stripe test card 4000 0000 0000 0002 | 1) Pay | Red message from Stripe; Pay button re-enabled; no order created | P1 | UI | F:159-163, F:276-278 |
| E-066 | Order fails after charge | needs simulated failure or invalid phone "12345" | 1) Fill phone "12345" (5 chars passes UI). 2) Continue. 3) Pay with test card | Backend rejects at /flights/orders with "Validation error" AFTER the card succeeded (phone min 6, rf:166); UI shows the message "Validation error", returns to payment step; retry cannot succeed. Record | P1 | Edge | F:233, F:254-273, rf:158-167; D-E-3, D-E-4 |
| E-067 | Passenger email format | modal | 1) Email "notanemail" (browser type=email may block form but not the button) | Button enabled (non-empty check only); later 400 after payment. Expected client-side validation | P2 | Validation | F:233, F:322; D-E-3 |
| E-068 | Non-admin direct call | TRAV token | 1) curl POST /flights/payment-intents {offerId:"x"} | 503 "Flight booking is not yet available" | P1 | Security | rf:36-41, rf:115; extends A-04 |
| E-069 | Duffel offer expired | wait past expires_at | 1) Continue to payment | Red "This fare has expired -- please search again" | P2 | Edge | sf:286-288 |
| E-070 | Bad clientToken | dev tools override response | 1) Make /payment-intents return non-base64 clientToken | `atob` or JSON.parse throws inside useMemo (F:280-283) and can blank the page (no error boundary seen); record | P3 | Edge | F:111-114, F:280-283; D-E-33 |

### 3.6 Regular traveller (compare only)

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-071 | Flights TRAV | TRAV logged in | 1) Search SYD to DPS one-way 2026-11-15 | Cards for every provider; each has disclosure "Shown for comparison" and disabled "Booking coming soon"; no "Book this flight" anywhere | P1 | Security | F:547-553, F:483-484; extends A-02 |
| E-072 | Flights TRAV status | TRAV | 1) Watch network | GET /tripgic/status returns bookingEnabled:false; no /tripgic/*/quote calls | P1 | Security | rt:50-53 |
| E-073 | Stays TRAV | TRAV | 1) Stays search Bali 15-18 Nov 2026 2 adults | Cards render; no "View rooms and book" | P1 | Security | S:218; extends A-03 |
| E-074 | Direct API TRAV | TRAV token | 1) POST /tripgic/flights/quote, /hotels/rooms, /flights/orders, /orders/:id/cancel | Every one returns 503 code payments_not_configured | P1 | Security | rt:41-46; extends A-04 |
| E-075 | Unauthenticated | no token | 1) Call any /tripgic/*, /flights/*, /stays/*, /notifications (except unsubscribe) | 401 | P2 | Security | authenticate middleware; extends A-08 |
| E-076 | TRAV Bookings tab | TRAV with no bookings | 1) Open Bookings | Trip updates block (with settings), no "Flights and stays", empty state "No bookings yet" | P2 | UI | B:36-41, TB:274 |

### 3.7 Stays search

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-077 | Stays basic search | ADMIN, Stays tab | 1) Destination "Bali". 2) Check-in 2026-11-15. 3) Check-out 2026-11-18. 4) Rooms 1, Adults 2. 5) Click "Search stays" | Button "Searching..."; banner "Searching hotels -- this can take up to a minute."; fast results (if any) appear with banner "Searching more hotels -- more results will appear below in about a minute."; TripGic results appended within about 60 s; banner clears | P1 | UI | S:110-135, S:181-187; extends H-01 |
| E-078 | Empty destination | Stays tab | 1) Leave Destination empty. 2) Search | Error "Enter a destination."; no request | P2 | Validation | S:111 |
| E-079 | Missing dates | Stays tab | 1) Bali, only check-in. 2) Search | Error "Pick check-in and check-out dates." | P2 | Validation | S:112 |
| E-080 | Check-out before check-in | Stays tab | 1) Check-in 2026-11-18. 2) Type check-out 2026-11-15. 3) Search | Backend zod does not compare dates (rs:33-39); provider error or empty; record message | P2 | Validation | S:159, rs:33-39; D-E-9 |
| E-081 | Rooms and adults bounds | Stays tab | 1) Rooms 0, 9. 2) Adults 0, 17, empty | Empty or 0 becomes 1; 9 rooms sends 9 and API returns 400 "Validation error" (max 8); adults 17 same | P2 | Validation | S:163, S:167, rs:37-38 |
| E-082 | Photos | Results visible | 1) Inspect cards. 2) Block an image host | Photo shown when available; broken image hides itself; card layout stays intact | P2 | UI | S:200-203; extends H-02 |
| E-083 | Provider tag and price | Results visible | 1) Read cards | "via TripGic", "via Travelport", "via Duffel" tags; price via Price (currency selector aware); Travelport with no rate shows "Price unavailable" | P2 | UI | S:207-212; extends H-03 |
| E-084 | Repeat search cached | after E-077 | 1) Search the same again within 30 min | TripGic results appear almost immediately (Redis cache, `status ready` on first POST) | P2 | UI | sts:212, rs:99-101; extends H-04 |
| E-085 | Newer search wins | slow TripGic | 1) Search Bali. 2) While banner shows, change dates and search again | Old poll stops; only new results appear; banner reflects the new search | P1 | Edge | S:76-77, S:86-107, S:114; extends H-05 |
| E-086 | Old results while new search runs | after E-077 | 1) Search another destination | Old fast results stay visible until the new fast response arrives (setResults not cleared, S:121-125); record | P3 | Edge | S:110-135; D-E-21 |
| E-087 | Leave tab while polling | Stays tab | 1) Search. 2) Switch to Bookings within 5 s. 3) Return | No console errors, no stuck spinner; unmount bumps token so the loop stops | P2 | Edge | S:77; extends H-07 |
| E-088 | Nonexistent destination | Stays tab | 1) Destination "Zzzzqx". 2) Search | "No places found for that search." or a friendly 400 message ("Could not find a location..."); no crash | P2 | Edge | S:192, rs:81-83; extends H-06 |
| E-089 | Fast providers fail, TripGic ok | Duffel Stays blocked (it is: 403) and Travelport failing | 1) Search | Error hidden while TripGic searches (S:179), then TripGic results appear | P2 | Edge | S:179, rs:71-73 |
| E-090 | TripGic fails | owner blocks TripGic | 1) Search | Fast results stay; note "Some additional hotel results couldn't be loaded." | P2 | Edge | S:188-190; extends R-01 |
| E-091 | Poll ceiling | backend paused | 1) Search while backend returns "unknown" | Polls for 150 s then shows the failed note; banner stays the whole time (unknown treated like pending) | P3 | Edge | S:91-92, S:47, rs:113-114; D-E-22 |
| E-092 | Three rooms, one adult | Stays tab | 1) Rooms 3, Adults 1. 2) Search | TripGic collapses to 1 room (sts:101-106); Duffel and Travelport get rooms 3 and may error; results consistent or friendly error | P3 | Edge | sts:101-106, S:115; D-E-23 |
| E-093 | Subtitle | ADMIN and TRAV | 1) Read page subtitle | Says "booking is coming soon" even for ADMIN who can book (stale copy) | P3 | UI | S:144; D-E-16 |

### 3.8 Hotel checkout (ADMIN)

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-094 | Open rooms | ADMIN, TripGic hotel card | 1) Click "View rooms and book" | Modal "Rooms -- <hotel>", line "2026-11-15 to 2026-11-18 · 3 nights · 2 adults", "Loading rooms..." then list | P1 | UI | S:218-220, T:376-386; extends H-08 |
| E-095 | Room cards | rooms loaded | 1) Read cards | Title, price (Price), beds joined by " or ", meals, "Free cancellation until <date>" or "Non-refundable", up to 8 amenities; sorted cheapest first | P2 | UI | T:386-405, stb:289 |
| E-096 | No rooms | hotel with none | 1) Open rooms | "No rooms are available for these dates." | P2 | Edge | T:385, stb:265 |
| E-097 | Select room | rooms shown | 1) Click "Select" on a room | Button "Checking..." then "Guest details" step with room title, price bar, sandbox notice, one guest block per adult; price equals room list price | P1 | UI | T:332-344, T:409-415; extends H-09, H-10 |
| E-098 | Room gone | stale room | 1) Select an expired room | Red "That room is no longer available" or server text; stays on room list | P2 | Edge | T:340, stb:298 |
| E-099 | Guest form validity | guest step | 1) Names blank. 2) Fill guests. 3) Add contact | Book disabled until all guests named and contact valid | P1 | Validation | T:346 |
| E-100 | Multi-room labels | search Rooms 2, Adults 4 | 1) Select a room | Guests labelled "Guest 1 (room 1)", "Guest 2 (room 1)", "Guest 3 (room 2)", "Guest 4 (room 2)" | P2 | UI | T:418; extends H-11 |
| E-101 | Submit hotel | valid | 1) Click Book | While wallet empty: red "We can't complete this booking right now -- please try again later" (503) and no row in Your hotel bookings; with funded wallet "Stay confirmed" | P1 | UI | T:348-371, stb:708-716; extends H-12, H-13 |
| E-102 | Choose different room | guest step | 1) Click "Choose a different room" | Returns to room list without reloading; dates kept; guest data kept if same room count | P2 | UI | T:430; extends H-14 |
| E-103 | Stale acceptPrice | priceChanged room then another | 1) Tick "I accept" on room A. 2) Choose different room B (priceChanged) | Checkbox stays ticked (never reset); record | P3 | Edge | T:319, T:430; D-E-11 |
| E-104 | Hotel quote timeout | slow upstream | 1) Select room when validate plus detail take over 30 s | UI aborts at 30 s and shows "That room is no longer available." (misleading); record | P3 | Edge | T:336, T:340, stb:295-305, tripgicClient.ts:19; D-E-17 |

### 3.9 Orders, cancellation, Bookings tab

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-105 | Your flight bookings list | ADMIN with held orders (12 exist) | 1) Open Flights, scroll to "Your flight bookings" | Cards with title, "Reserved" gold pill, "Ref FL... · $X USD · test booking", message, "Cancel booking" link | P1 | UI | T:443-487; extends F-19, O-01, O-02 |
| E-106 | Cancel booking | a held order | 1) Click "Cancel booking" | Button "Cancelling..."; red "We couldn't cancel this booking online -- please contact support" (sandbox refuses); status stays Reserved | P2 | UI | T:451-462, stb:829-835; extends O-03; D-E-6 |
| E-107 | Cancel non-owner | user B token | 1) POST /tripgic/orders/<A order id>/cancel | 404 "Booking not found" | P1 | Security | stb:819-820; extends A-07 |
| E-108 | Hold expiry | order with hold_expires_at in past | 1) Open Flights (GET /tripgic/orders) | Status becomes Expired, grey pill, no Cancel link | P2 | UI | stb:762-767; extends F-22 |
| E-109 | Held never syncs | held order ticketed in TripGic back office | 1) Refresh Bookings and Flights | Still "Reserved": UI never calls GET /tripgic/orders/:id (only that route syncs) | P2 | Edge | stb:780-815, T:448; D-E-5 |
| E-110 | Bookings tab ADMIN | ADMIN with 12 held, 3 Duffel | 1) Open Bookings | Sections: Trip updates, "Flights and stays" with Upcoming and "Past, cancelled or expired"; no "Local experiences" (empty) and no empty state | P1 | UI | B:29-64, TB:276-297 |
| E-111 | Card contents flight | TripGic flight card | 1) Read card | Route with cities, "With <airline>", Outbound and Return legs with day, time, flight numbers, stops or "direct", Passengers, Booking ref, Airline ref, Total with "Test booking, not charged", "Booked through Drift · via TripGic", note "Held until <date>" | P1 | UI | TB:186-246 |
| E-112 | Next-day arrival | SYD to DPS one-stop fare arriving next day | 1) Read leg | Arrival shows a date when different from departure day | P2 | UI | TB:76; extends R-2 |
| E-113 | Reminders on trip card | held TripGic test booking (NOTIFICATIONS_TEST_TRIPS=true) | 1) Read card | "Reminders" block lists "1 week before (Tue ...)" etc. from GET /notifications/schedule; no block when none | P2 | UI | TB:167-175, TB:231-238; extends R-1 |
| E-114 | Duffel card status | 3 confirmed Duffel test orders | 1) Read cards | Shown as "Ticketed" with "Your tickets are issued." though key is test and testBooking=false | P3 | Edge | TB:133-158; D-E-18 |
| E-115 | Operator bookings | OPER with bookings | 1) Open Bookings | Cards should show traveller name; actual: blank title (GET /bookings operator rows lack business_name) | P2 | Edge | rb:111-113, B:48; D-E-12 |
| E-116 | ADMIN GET /bookings | ADMIN | 1) Open Bookings, check console | 403 logged to console, page still renders | P3 | Edge | rb:123, B:23; D-E-13 |
| E-117 | Traveller local experiences | TRAV with one booking | 1) Open Bookings | "Local experiences" heading only when travel bookings exist; card with business, status badge, dates, guests, amount | P2 | UI | B:44-60 |

### 3.10 Notifications and reminders

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-118 | Trip updates list | ADMIN after E-052 | 1) Open Bookings | Item titled "[TEST] Your seats are reserved" with "just now" timestamp, unread gold border, badge "N new" | P1 | UI | TU:158, TU:182-189; extends R-1 |
| E-119 | Mark all read | unread items | 1) Click "Mark all read" | Badge and link disappear; items lose gold highlight | P1 | UI | TU:160, TU:132, rn:77 |
| E-120 | No per-item read | unread item | 1) Click an item | Nothing happens (no click handler; POST /:id/read has no UI) | P3 | Edge | TU:183-189, rn:87; D-E-14 |
| E-121 | Toggle email off | Reminder settings open | 1) Click "Reminder settings". 2) Untick "Email me trip reminders". 3) Reload | Checkbox unticked immediately, saved (PUT {emailEnabled:false}), remains off after reload; consent recorded | P1 | UI | TU:168, rn:113-134; extends R-3 |
| E-122 | Toggle in-app off | as E-121 | 1) Untick "Show reminders here in Drift" | Saved; future in-app reminders not created (worker checks prefs) | P2 | UI | TU:172 |
| E-123 | Toggle failure rollback | block PUT | 1) Untick a box | Box returns to previous state, red "Couldn't save that. Please try again." | P2 | Edge | TU:145-148 |
| E-124 | Unsubscribe GET no side effect | email link | 1) Open the link in a browser (or curl GET) | Confirm page "Stop trip reminder emails?"; DB `email_enabled` unchanged | P1 | Security | rn:33-39; extends R-5 |
| E-125 | Unsubscribe POST | same link | 1) Click "Stop trip emails" | Page "You're unsubscribed"; email_enabled=false, pending email rows skipped 'opted_out'; Reminder settings shows email off after reload | P1 | UI | rn:41-60; extends R-5 |
| E-126 | Unsubscribe tampered token | altered link | 1) Change one character of token. 2) GET and POST | 400 page "This link isn't valid"; nothing changes | P1 | Security | rn:34-35, notificationTokens.ts:26-40 |
| E-127 | Admin tools guarded | TRAV token | 1) POST /notifications/admin/test-send and /admin/process | 403 "Admin only" | P1 | Security | rn:19-22 |
| E-128 | Held test booking reminders | ADMIN test booking, NOTIFICATIONS_TEST_TRIPS true | 1) Book test flight. 2) Check GET /notifications/schedule | Reminders scheduled for held test booking of admin only; TRAV test bookings get none | P2 | Security | stn:198-205; extends R-1, R-8 |
| E-129 | Hold lapse cancels reminders | order expires | 1) Let hold lapse. 2) Reopen Bookings | Reminders vanish from card | P2 | Edge | stn:228-234; extends R-8 |

### 3.11 Currency selector and conversion

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-130 | Selector presence | rates available | 1) Open Flights and Stays | "Show prices in" select with 10 currencies: AUD, USD, EUR, GBP, NZD, SGD, CAD, IDR, JPY, INR; default AUD | P2 | UI | CU:144-160, fx:24-35 |
| E-131 | Convert USD fare | TripGic offer (USD) | 1) Select AUD | Price shows "≈ $X" with sub-line "Priced in USD Y"; Duffel AUD fare shows no sub-line | P1 | UI | CU:64-71 |
| E-132 | Persistence | after E-131 | 1) Pick EUR. 2) Reload. 3) Open Stays | Selection kept (localStorage drift.currency); same on Stays; DevTools shows the key | P1 | UI | CU:26-28, CU:93-96 |
| E-133 | Rates unavailable | GET /currencies available:false (owner) | 1) Open Flights | No selector; every price in its own currency; sorting falls back | P2 | Edge | CU:86, CU:146, rc:164 |
| E-134 | Button labels | TripGic modal in AUD | 1) Read Book button | "Book -- ≈ $X (USD Y)" in the chosen currency | P2 | UI | T:280, CU:115-121 |
| E-135 | Non-converted spots | Duffel modal, Bookings cards | 1) Read prices | These use raw "$X CUR" (F:328, F:335, TB:227), not the selector; record as inconsistent | P3 | UI | F:328, F:744, TB:227; D-E-20 |

### 3.12 Mobile layout (375 px)

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-136 | Trip type row | viewport 375x812, Flights | 1) View search card | Three pills fit inside the card; estimate is about 317 px wide against about 255 px, so overflow or clipping is likely (row has no wrap) | P2 | Mobile | F:765, F:576-597; D-E-15 |
| E-137 | Search fields | 375 px | 1) Inspect the form | Fields stack one per row, no horizontal page scroll; date pickers usable | P2 | Mobile | F:768-770 |
| E-138 | Offer card header | 375 px, converted price | 1) Read a card with "Priced in ..." sub-line | Logo, airline, tag and price fit or wrap; no overflow | P2 | Mobile | F:791, F:509-514 |
| E-139 | Mix summary sticky | 375 px, both picks | 1) Scroll | Sticky bottom summary does not cover the Book buttons permanently; all three actions reachable | P2 | Mobile | F:780 |
| E-140 | Duffel modal | 375 px | 1) Open passenger step | Two-input rows (given/family, DOB/email) fit without horizontal scroll inside the modal | P2 | Mobile | F:822, F:316-323; D-E-15 |
| E-141 | TripGic modal | 375 px | 1) Open flight and hotel modals | Rows fit; modal scrolls vertically (max-height 88vh); Book button reachable; passport country box 70 px OK | P2 | Mobile | T:493, T:504, T:506; extends R-06 |
| E-142 | Unsubscribe page | 375 px | 1) Open link | Readable, button visible, no horizontal scroll | P3 | Mobile | rn:29-31; extends R-6 |

### 3.13 API and security edge

| ID | Area | Precondition / data | Steps | Expected result | Pri | Type | Source |
|---|---|---|---|---|---|---|---|
| E-143 | Flight search body validation | any user token | 1) POST /flights/search with origin "SYDX" | 400 "Validation error" | P3 | API | rf:44, rf:97 |
| E-144 | Quote id injection | ADMIN | 1) POST /tripgic/flights/orders with quoteId "../x" | 400 or 410, never 500 | P2 | Security | stb:123, stb:155 |
| E-145 | Price never client-sent | ADMIN | 1) Inspect order request bodies | No price or amount fields in any /tripgic order body | P1 | Security | T:222-230 |
| E-146 | TripGic flag off | owner unsets TRIPGIC_PAYMENT_MODE | 1) Reload Flights as ADMIN | status false; no Book buttons; direct API returns 503 | P1 | Security | rt:37-39; extends A-04 rollback |
| E-147 | Passport not stored | after E-052 | 1) SELECT details FROM tripgic_orders | No passport data in details (names and DOB only) | P1 | Security | stb:625-629; extends A-11 |
| E-148 | Response leakage | any TripGic error | 1) Compare UI messages | No wallet or supplier text; funding failure gives generic try again | P1 | Security | stb:446-450, stb:607-611; extends A-12 |
| E-149 | Console clean | every screen in this plan | 1) Open DevTools console while doing E-001, E-077, E-110 | No red errors except the expected ADMIN /bookings 403 | P3 | UI | B:23; extends R-08 |


---

## 4) Suspected defects

Severity: 1 = crash, data loss or money taken with no product; 2 = a main path does not work; 3 = wrong or misleading behaviour with a workaround; 4 = cosmetic or low impact. "CODE" = proven by reading code on both sides. "RUNTIME" = needs a browser or live call to confirm. No Sev 1 found: the money paths run on a Duffel test key and a TripGic sandbox, admin only. Related test cases: D-E-1 = E-032, D-E-2 = E-033, D-E-3 and D-E-4 = E-066, D-E-5 = E-109, D-E-6 = E-106, D-E-7 = E-003, D-E-8 = E-040.

| ID | Sev | What is wrong | Evidence (file:line) | Confirmed by |
|---|---|---|---|---|
| D-E-1 | 2 | "Book both flights" with two TripGic fares never opens a usable second checkout. Done or X calls onClose, which sets tripgicOfferId to null and then to the return offer in the same batched render, so `TripgicFlightCheckout` is never unmounted (it has no `key`). Its `order` state survives, so the first booking's result panel is shown again and the return flight cannot be booked. Workaround: "Book return only". | F:711-724, F:491-494, F:717-721; T:193-200 (state), T:202-212 (effect only refetches the quote), T:249 (`quote && order` renders OrderResult) | CODE (React 18.3.1 batching); RUNTIME to see exact screen |
| D-E-2 | 2 | "Book both flights" with two Duffel fares: `CheckoutModal` has no `key`, so it is reused for the second offer. `step` stays 'submitting' (never reset after success), so the modal shows "Booking your flight..." forever with the old payment intent. `startBooking` also calls `setBooking(null)`, erasing the first confirmation code. | F:211, F:251, F:346, F:486-489, F:728-733 | CODE |
| D-E-3 | 2 | Duffel passenger form only checks non-empty. The backend needs a valid email, phone of at least 6 chars and a date (zod). That check runs at POST /flights/orders, which is called AFTER the card was charged. The user sees only "Validation error". | F:233, F:254-255, F:271-273; rf:158-167, rf:189 | CODE |
| D-E-4 | 2 | If the order step fails after a successful card charge, the UI returns to the card step with fresh Stripe fields. The payment intent is already paid, so paying again cannot succeed and there is no "retry booking" action. | F:164-168, F:249-273, F:333-344 | RUNTIME |
| D-E-5 | 3 | Held TripGic bookings can never move to Ticketed or Cancelled in the UI. The only code that re-reads TripGic (`syncOrderFromTripgic`) runs in GET /tripgic/orders/:id, which no web screen calls; the list route does not sync. DB has 12 held and 0 ticketed. | stb:780-815 (sync), stb:759-770 (list), rt:186-192; T:448 (list only); no caller in web/src | CODE |
| D-E-6 | 3 | "Cancel booking" is shown on every held order but cannot succeed in the sandbox (TripGic refuses API cancels), so the user always gets "couldn't cancel ... contact support". | T:480-482, T:451-462; stb:829-835; plan O-03 | CODE plus RUNTIME |
| D-E-7 | 3 | Round trip with the Return field empty silently runs a one-way search. Only mix mode requires a return date. | F:426, F:460 | CODE |
| D-E-8 | 3 | Mix results use live form state. Headings show the current From, To and dates, not the searched ones; switching to Round trip or One way does not clear mix results; Book both remains usable on stale picks. | F:654, F:659, F:403-406 | CODE |
| D-E-9 | 3 | Weak search validation: airport code is any 3 characters (no A-Z), origin may equal destination, past dates and return before departure pass zod, stays check-out may precede check-in. ZodError surfaces as the bare text "Validation error". | rf:44-47, rf:97; rs:33-39; F:421-425, F:473, F:610, F:615; S:112, S:130, S:159 | CODE (gaps); RUNTIME (provider messages) |
| D-E-10 | 3 | A Duffel failure (for example a 422 for a bad date) aborts the whole flight search and discards TripGic and Travelport results that succeeded. | rf:73, rf:101 | CODE |
| D-E-11 | 3 | `acceptPrice` is never reset between quotes, so "I accept the new price" can stay ticked for a different fare or room. The price_changed 409 branch is effectively unreachable because the Book button is disabled until the box is ticked. | T:197, T:319, T:430, T:215, T:236-238; stb:538-545 | CODE |
| D-E-12 | 3 | Operator Bookings tab shows blank titles: the operator query does not select `business_name`, but the card renders it. Operators also see traveller-oriented "Trip updates" and the empty text "Browse operators and make your first booking." | rb:111-113; B:32, B:37-41, B:48 | CODE |
| D-E-13 | 4 | Admin accounts get 403 from GET /bookings on every Bookings load (role is neither traveler nor operator); swallowed into the console. | rb:97, rb:109, rb:123; B:21-23 | CODE |
| D-E-14 | 4 | In-app notifications: no per-item mark read (route exists, no control), `link` unused, unread badge counts only the newest 30. | TU:183-189; rn:67, rn:70, rn:87 | CODE |
| D-E-15 | 3 | Likely overflow at 375 px: trip-type pills row does not wrap (about 317 px of pills in about 255 px); modal input pairs use `width:100%` in flex rows with no `min-width:0`. | F:765, F:576-597, F:822, F:316-323; T:504-506 | RUNTIME |
| D-E-16 | 4 | Stale copy: Stays subtitle says "booking is coming soon" although admins can book; Flights says "Search real fares and book directly" although non-admins cannot. | S:144; F:571 | CODE |
| D-E-17 | 3 | Hotel "Select" has a 30 s client timeout, but the server makes two sequential TripGic calls (validate, then price-detail) of up to 20 s each. A timeout shows the misleading "That room is no longer available." | T:336, T:340; stb:295-305; utils/tripgicClient.ts:19 | RUNTIME |
| D-E-18 | 3 | The 3 Duffel test orders show as "Ticketed - Your tickets are issued." with no test-booking flag, although the key is `duffel_test_` and issues no ticket. | TB:143, TB:153; sf:376 | CODE |
| D-E-19 | 4 | `UnderConstructionScreen` is dead code (not imported anywhere). | UC:1-56; AppShell.web.tsx:91-100 | CODE |
| D-E-20 | 4 | Several prices bypass the currency selector and show a raw "$X CUR": Duffel modal, Duffel "Your bookings", Bookings cards, TripGic order lists. | F:328, F:335, F:744; TB:227; T:80, T:476 | CODE |
| D-E-21 | 4 | A new stays search does not clear the previous fast results, so old cards remain while the new search runs. | S:110-135, S:137 | CODE |
| D-E-22 | 4 | The stays poll treats status "unknown" (never started or expired) as pending for up to 150 s; the backend comment says the client should just search again. | S:47, S:91-92; rs:113-114 | CODE |
| D-E-23 | 4 | Rooms greater than adults is handled differently per provider (TripGic caps rooms at adults; Duffel and Travelport get the raw room count). | sts:101-106; services/stays.ts:85-86; services/travelportStays.ts (RoomStayCandidate block) | RUNTIME |
| D-E-24 | 4 | Phone and passport inputs have no max length, so over-long entries enable Book and then fail with "Validation error". | T:131-132, T:266; rt:72-73, rt:104 | CODE |
| D-E-25 | 3 | No sanity check on date of birth (future date) or passport expiry (expired) in the UI or zod; the supplier decides. | T:214, T:261, T:270; rt:103-106; stb:592-594 | RUNTIME |
| D-E-26 | 4 | Flight airline logo has no onError fallback (stays photos do). | F:510; S:202 | CODE |
| D-E-27 | 4 | Duffel checkout has no way back from the payment step to fix passenger details. | F:333-344 | CODE |
| D-E-28 | 4 | Time formats differ: search cards use 12-hour en-US, Bookings cards use 24-hour en-AU. | F:93-96; TB:66-73 | CODE |
| D-E-29 | 3 | Clicking the modal overlay closes a checkout even while a booking request is in flight; the order may complete server-side but the user never sees the result. | T:88, T:217-243; F:290 | CODE (close path); RUNTIME (outcome) |
| D-E-30 | 4 | Mix summary shows only slice 0 of a picked offer (safe for one-way legs, misleading if a multi-slice offer were ever picked). | F:669, F:675 | CODE |
| D-E-31 | 4 | Every "Book this flight" click calls the quote endpoint, sharing one 30 per 10 minute limit with orders and cancels; browsing several fares can exhaust it. | rt:24-30, rt:85, rt:116, rt:194 | RUNTIME |
| D-E-32 | 4 | Duffel offer expiry is never shown, so a stale offer only fails at "Continue to payment". | F:54-66 (expiresAt unused); sf:286-288 | CODE |
| D-E-33 | 3 | `decodeClientToken` runs `atob` and `JSON.parse` inside `useMemo`; a malformed client token throws during render and can blank the page (no error boundary seen in these files). | F:111-114, F:280-283 | RUNTIME |

Not defects (existing plan section 12): USD versus AUD fares, cheapest-100 hotel cap, no review scores, guest age sent as 30, booking admin-only and sandbox-only, cancel refused by the sandbox at TripGic, held flight expected while the wallet is empty.

---

COUNTS: controls = 81 rows (80 UI or automatic controls plus 1 grouped row for 6 API-only endpoints); test cases = 149 (E-001..E-149); suspected defects = 33: Sev 1 = 0, Sev 2 = 4, Sev 3 = 14, Sev 4 = 15.
