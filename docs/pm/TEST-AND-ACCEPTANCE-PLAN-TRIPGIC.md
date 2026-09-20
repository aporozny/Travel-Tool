# Drift: TripGic Flights and Stays. Test and Acceptance Plan

Version 1.0, 20 Sep 2026. Covers the flight and hotel search and booking added in commits `d794a37` to `a45c4f8`, and the ungating of the Flights tab.

**How to use this file:** work top to bottom. Tick `[x]` on pass. On fail, write what you saw next to the ID and give it a severity (section 9). Every test has a stable ID so we can refer to it ("F-07 fails").

**Status key** (in the *Run* column):
- **AUTO ✔** already passing in the automated suite (38 checks, last run 20 Sep). Re-run it, don't repeat it by hand.
- **MANUAL** needs a person and a browser. **Nothing in the UI has been viewed in a browser yet**, so these are the tests that matter most today.
- **BLOCKED-W** cannot pass until TripGic Finance approves the sandbox wallet deposit.
- **BLOCKED-P** cannot pass until Drift has its own card payments (Stripe) and refunds.
- **GO-LIVE** a launch gate, not a test of the current build.

---

## 1. What we are proving

That a signed-in traveller can **search** and (in sandbox) **book** flights and hotels through TripGic, that the **price shown is the price booked**, that **nobody can book without paying** once real payments exist, and that **nothing breaks** for existing Duffel / Travelport / Stays users.

**In scope:** TripGic flight search, flight booking, hotel search, hotel rooms and booking, order list, cancel, markup, access control, the Flights tab ungating, Duffel test-mode guard.

**Out of scope for this cycle:** real customer card payments, refunds, AUD currency conversion, flight extras (seats, bags, meals), changing or rescheduling bookings, multi-city, child/infant passengers.

## 2. Environment

| Item | Value |
|---|---|
| App | https://drifttravel.app (web build served by nginx from `web/dist`) |
| Backend | Docker `traveller-backend`, API at `/api/v1` |
| TripGic | Sandbox, partner id `15` (Quattro Finance), USD |
| Duffel | `duffel_test_` key. Bookings issue no real ticket |
| Mode flag | `TRIPGIC_PAYMENT_MODE=sandbox`. Orders are marked *not collected* |
| Wallet | **Empty.** Deposit of USD 5,000 is pending TripGic Finance |
| Markup rule | Global, 8% of price, minimum $5, maximum $150 |

**Accounts**

| Role | Account | Used for |
|---|---|---|
| Admin | `aporozny@gmail.com` (yours) | All booking tests. Only admins can book while payments are sandbox-only |
| Regular traveller | **Create a fresh one** via sign-up, e.g. `test.traveller+1@…` | Access-control tests. Should see everything *except* Book buttons |

**Test data (use these so results are comparable)**

| Purpose | Value |
|---|---|
| Flight one-way | SYD → DPS, 15 Nov 2026, 1 adult, economy |
| Flight return | SYD ⇄ DPS, 15 Nov and 25 Nov 2026, 1 adult |
| Flight 2 pax | SYD → DPS, 15 Nov 2026, 2 adults |
| Hotel A | "Bali", 15 to 18 Nov 2026, 1 room, 2 adults |
| Hotel B | "Seminyak", 15 to 18 Nov 2026, 2 rooms, 4 adults (multi-room) |
| Passenger | Sandbox Tester, born 1990-01-01, passport `PA1234567`, AU, expiry 2031-01-01 |
| Contact | `sandbox-test@drifttravel.app`, +61, 0400000000 |

Dates must stay in the future. If today is after 15 Nov 2026, move every date forward.

## 3. Entry criteria (before we start)

- [ ] `git log` on the VPS shows `a45c4f8` (or later) and `origin/main` matches.
- [ ] Automated suite passes: the command in section 11 ends with *38 passed, 0 failed*.
- [ ] You can log in as admin at https://drifttravel.app and the **Flights** tab now opens (no "under construction" page).
- [ ] A second, regular traveller account exists.

## 4. Access and security

| ID | Test | Expected | Run |
|---|---|---|---|
| A-01 | Regular traveller opens Flights and Stays | Both tabs open, searches work | AUTO ✔ (API) + MANUAL (UI) |
| A-02 | Regular traveller runs a flight search | Duffel, Travelport and TripGic fares listed; **no Book button anywhere**, all say "Booking coming soon" | MANUAL |
| A-03 | Regular traveller runs a Stays search | TripGic hotels appear with photos; **no "View rooms and book"** | MANUAL |
| A-04 | Regular traveller calls any booking API directly (quote, rooms, order, cancel, Duffel payment-intent / confirm / order) | `503 not available`, nothing reserved | AUTO ✔ |
| A-05 | Admin sees Book buttons on TripGic flights and "View rooms and book" on TripGic hotels | Visible | MANUAL |
| A-06 | Admin sees Duffel fares | Duffel fares bookable for admin (test mode), compare-only for everyone else | MANUAL |
| A-07 | User B cannot see, cancel or re-use user A's quote or order | 404 / "price expired", indistinguishable from "does not exist" | AUTO ✔ |
| A-08 | Not signed in: every `/tripgic/*` call | 401 | MANUAL (curl, no token) |
| A-09 | Role comes from the database, not the token: a token claiming `admin` for a regular user still cannot book | 503 | MANUAL (needs a forged token; ask me to run it) |
| A-10 | Rate limit: 31 booking attempts in 10 minutes | 429 "Too many booking attempts" | MANUAL |
| A-11 | Passport number is **not stored**: after booking, `SELECT details FROM tripgic_orders` contains names and date of birth only | No passport number anywhere | MANUAL (SQL, section 11) |
| A-12 | API responses never contain the TripGic key, secret, wallet balance or TripGic's raw error text; backend logs never contain the key or secret (logs *do* keep TripGic's raw reason for our debugging, by design) | Clean | MANUAL (section 11) |

## 5. Flights

### 5.1 Search

| ID | Test | Expected | Run |
|---|---|---|---|
| F-01 | One-way search | Results within ~10 s. Includes rows tagged **via TripGic** (Malindo, Scoot, etc.) | AUTO ✔ + MANUAL |
| F-02 | Return search | TripGic rows show both directions; times and stops sensible | MANUAL |
| F-03 | Results are sorted cheapest first across all providers | Ascending | MANUAL |
| F-04 | Search with no results (e.g. a route TripGic doesn't serve) | Clean "no flights" message, **no error banner**, other providers unaffected | MANUAL |
| F-05 | TripGic down: (ask me to block it) | Duffel / Travelport results still shown, no error | MANUAL |
| F-06 | Price shown for a TripGic fare **includes markup** | e.g. cost 149.07 shows 161.00 | AUTO ✔ |

### 5.2 Booking (admin)

| ID | Test | Expected | Run |
|---|---|---|---|
| F-07 | Click **Book this flight** on a TripGic fare | Modal opens, shows "Confirming this fare…", then route, date, **total price**, and a gold notice *"Test booking -- no payment is taken and nothing is charged to a card."* | MANUAL |
| F-08 | Total in the modal equals the price on the search card | Identical to the cent | AUTO ✔ (API) + MANUAL |
| F-09 | Submit with empty fields | **Book button disabled** until names, DOB, passport (international), email and phone are valid | MANUAL |
| F-10 | Passport fields | Shown for international routes; number accepts letters and digits only; country upper-cases to 2 letters | MANUAL |
| F-11 | Bad phone ("abc") or bad email | Not accepted / validation error | AUTO ✔ (API) + MANUAL |
| F-12 | Book with valid details | Spinner, then result panel titled **"Reserved -- not finalised yet"** with a reference (`FL…`), airline reference (PNR), total, and "Test booking, not charged". *While the wallet is empty this is the correct outcome* | MANUAL |
| F-13 | Double-click Book / refresh mid-submit / submit twice | **One** booking only (same order returned) | AUTO ✔ (API) + MANUAL |
| F-14 | Two passengers (Flight 2 pax) | Two passenger blocks; both required | MANUAL |
| F-15 | Return fare booking | Both legs shown in the title and result | MANUAL |
| F-16 | Leave the modal open for more than about 10 minutes (TripGic's own session limit), then Book | "This price has expired, please start again". No booking made | MANUAL |
| F-17 | Fare price changes between search and booking (TripGic re-prices) | Red "Price changed from X" banner and an **"I accept the new price"** tick box required before Book enables | MANUAL (hard to force; ask me to simulate) |
| F-18 | Wrong number of passengers / missing passport sent straight to the API | 400 with a clear code | AUTO ✔ |
| F-19 | Close the modal after booking, reopen the Flights tab | Booking appears under **"Your flight bookings"** with status *Reserved* | MANUAL |

### 5.3 Ticketing

| ID | Test | Expected | Run |
|---|---|---|---|
| F-20 | With a funded wallet, book a flight | Result panel says **"Tickets issued"** (green), status *Ticketed*, tickets visible in TripGic back office | **BLOCKED-W** |
| F-21 | Wallet drops below the fare mid-booking | Booking stays *Reserved*, traveller sees a neutral message, **no wallet amount or supplier text** shown | AUTO ✔ (empty-wallet case) |
| F-22 | A reserved flight not ticketed by its hold deadline | Shows *Expired* in the list | MANUAL (wait for the deadline, or ask me to age a row) |

## 6. Stays (hotels)

### 6.1 Search

| ID | Test | Expected | Run |
|---|---|---|---|
| H-01 | Search "Bali" (Hotel A) | Fast results appear first, then a **"Searching more hotels…"** banner; TripGic results are appended within ~60 s and the banner clears | MANUAL |
| H-02 | Every card shows a **photo**; broken images hide themselves | Photos load, no broken-image icons | MANUAL |
| H-03 | Cards show name, city/country, stars, amenities, price with **`via TripGic`** tag | Present | MANUAL |
| H-04 | Repeat the same search | Instant (cache) | AUTO ✔ |
| H-05 | Change dates or guests and search again while the first is still loading | Old results never overwrite the new search | MANUAL |
| H-06 | Search a destination that does not exist ("Zzzzqx") | Friendly "No places found", no crash | MANUAL |
| H-07 | Leave the tab while searching, come back | No console errors, no stuck spinner | MANUAL |

### 6.2 Booking (admin)

| ID | Test | Expected | Run |
|---|---|---|---|
| H-08 | Click **View rooms and book** on a TripGic hotel | Modal lists rooms with price, bed types, meals, **cancellation terms** (free until X / non-refundable) | MANUAL |
| H-09 | Room price in the list equals the price at the next step | Identical | AUTO ✔ |
| H-10 | Select a room | Guest form appears: one block per adult (labelled by room if multi-room), contact, special requests | MANUAL |
| H-11 | Multi-room search (Hotel B): guests split correctly across rooms | Guest 1-2 room 1, guest 3-4 room 2 | MANUAL (UI) |
| H-12 | Submit | **While the wallet is empty:** clear red message *"We can't complete this booking right now -- please try again later"*. **No booking appears in "Your hotel bookings"**, no wallet detail shown | AUTO ✔ (API) + MANUAL (UI) |
| H-13 | With a funded wallet | Green **"Stay confirmed"**, confirmation number, listed under "Your hotel bookings" | **BLOCKED-W** |
| H-14 | "Choose a different room" link | Returns to the room list without losing dates | MANUAL |
| H-15 | Wrong guest count sent to the API | 400 `guest_count` | AUTO ✔ |

## 7. Orders, cancellation, money

| ID | Test | Expected | Run |
|---|---|---|---|
| O-01 | Orders list shows only my own bookings, newest first | Correct | AUTO ✔ |
| O-02 | Status pill colours: green (ticketed/confirmed), gold (reserved), grey (cancelled/expired) | Correct | MANUAL |
| O-03 | **Cancel booking** on a reserved flight | **Expected today:** red message *"We couldn't cancel this booking online, please contact support"* and the booking **stays Reserved**. (TripGic's sandbox refuses cancels through the API.) It must never show *Cancelled* unless TripGic really cancelled it | AUTO ✔ (API) + MANUAL |
| O-04 | Cancelling a paid/ticketed booking | Refused, "contact support" | BLOCKED-P |
| O-05 | Charged = cost + markup for every order (SQL, section 11) | Difference under 1 cent | AUTO ✔ |
| O-06 | Markup vectors (cost → charged): 40.00 → **45.00** (minimum $5), 149.07 → **161.00**, 1,000 → **1,080.00**, 3,000 → **3,150.00** (cap $150) | As listed | MANUAL (quote a fare in each band, or ask me to run) |
| O-07 | Currency shown is USD everywhere and labelled | "USD" visible | MANUAL |
| O-08 | Sandbox orders are flagged `not_collected_sandbox` and the UI says "test booking, not charged" | Yes | AUTO ✔ |

## 8. Resilience and regression

| ID | Test | Expected | Run |
|---|---|---|---|
| R-01 | Restart the backend during a hotel search | Frontend eventually shows "Some additional hotel results couldn't be loaded"; page still usable; a new search works | MANUAL (ask me to restart) |
| R-02 | Flush Redis, then complete a booking that was quoted before the flush | "Price expired, start again". No half-booking | MANUAL |
| R-03 | TripGic slow (> 20 s) on a flight quote | Friendly timeout message, nothing booked | MANUAL |
| R-04 | Duffel and Travelport searches, results and Stays browse for a **regular** traveller are unchanged | Same as before this work | MANUAL |
| R-05 | All other tabs (Explore, Community, Trips, Bookings, Safety, Profile) still load | No errors | MANUAL |
| R-06 | Mobile (phone width): Flights and Stays search, both modals | No horizontal scroll, buttons reachable, modal scrolls | MANUAL |
| R-07 | Browsers: Chrome, Safari, Edge (latest) | Same behaviour | MANUAL |
| R-08 | Browser console shows no red errors on Flights and Stays | Clean | MANUAL |
| R-09 | Failure inside our database after TripGic accepted a booking | Booking is cancelled at TripGic, traveller sees "couldn't save your booking, try again". No orphan | MANUAL (not yet exercised at all; ask me to simulate. Note TripGic's sandbox refuses cancels, so in sandbox expect a logged "needs manual cleanup" instead) |

**Performance targets:** flight search under 10 s, hotel rooms under 8 s, quote under 5 s, hotel search may take up to 60 s but must never block the page.

## 9. Defect severity

| Sev | Meaning | Examples | Rule |
|---|---|---|---|
| 1 | Money or safety | Booking without payment for a regular user, wrong price charged, another user's data visible, secrets leaked | Blocks release, fix immediately |
| 2 | Core flow broken | Can't book, wrong dates or passengers sent, duplicate bookings | Blocks release |
| 3 | Works but wrong | Bad copy, layout glitch, wrong status colour | Fix before launch if cheap |
| 4 | Cosmetic | Spacing, wording | Backlog |

Report as: **ID, what you did, what you expected, what you saw, screenshot, browser/device.**

## 10. Acceptance (exit) criteria

**Accepted for continued sandbox testing** when all of these hold:

- [ ] Every AUTO test passes on the latest commit.
- [ ] Every MANUAL test in sections 4-8 passes, or has a logged Sev 3/4 defect.
- [ ] No open Sev 1 or Sev 2 defects.
- [ ] Regular travellers can never place a booking (A-02, A-03, A-04 pass).
- [ ] Price shown equals price booked for every order (F-08, H-09, O-05).

**Accepted for launch** additionally requires (none of these are met yet):

- [ ] **F-20 and H-13 pass**: a real ticket and a real hotel voucher issued with a funded wallet (BLOCKED-W).
- [ ] **Customer payments**: Drift takes the traveller's card (Stripe or equivalent) *before* the supplier is booked, with a tested refund path for failed or cancelled bookings (BLOCKED-P). Until then the sandbox admin-only lock stays on.
- [ ] Currency decision made: TripGic account switched to AUD, or FX handled (currently USD next to Duffel's AUD).
- [ ] TripGic's **per-transaction fee ($2-10)** confirmed and included in the markup rule. It is not visible in the sandbox price data.
- [ ] Seller-of-Travel / legal review (R9) complete; Privacy Policy and Terms cover bookings; refund and cancellation terms published.
- [ ] Support process for "reserved but not ticketed" and "cancel refused" bookings (someone owns the TripGic operations contact).
- [ ] Alerts on: low TripGic wallet balance, failed ticketing, backend errors on `/tripgic/*`.
- [ ] Duffel on a live key, or Duffel booking left admin-only.
- [ ] CI is green again (currently failing on 2 old lint errors, unrelated to this work, so its tests have not been running).
- [ ] Rollback: `TRIPGIC_PAYMENT_MODE` unset closes all TripGic booking instantly; verified by A-04 with the flag off.

## 11. Evidence and tooling

**Run the automated suite** (creates real *sandbox* holds, which TripGic auto-cancels the same day):
```
docker cp /home/andre/projects/drift/backend/scripts/tripgic-orders-api-test.js traveller-backend:/app/t.js
docker exec traveller-backend node /app/t.js
```

**Money integrity** (should return zero rows):
```sql
SELECT id, cost_amount, markup_amount, price_charged_amount
FROM tripgic_orders
WHERE abs(price_charged_amount - (cost_amount + markup_amount)) > 0.01;
```

**No passport data stored** (should return zero rows):
```sql
SELECT id FROM tripgic_orders WHERE details::text ~* 'passport';
```

**Recent orders and their state:**
```sql
SELECT created_at, product_type, status, payment_status, fulfilment_error, price_charged_amount, tripgic_booking_id
FROM tripgic_orders ORDER BY created_at DESC LIMIT 20;
```

**Secrets in logs** (should return nothing):
```
docker logs traveller-backend --since 24h 2>&1 | grep -iE "secretecode|apikey"
```
Logs *do* contain TripGic's raw failure reason, including "available balance 0.00", on purpose (server side only). That text must never appear in an API response: check A-12 by reading the JSON the browser receives (DevTools, Network tab) after a failed hotel booking.

## 12. Known behaviours (not defects)

- Prices are **USD**; Duffel's are AUD. Merged flight sorting compares the two numerically. Fix is the AUD request to TripGic.
- The cheapest 100 hotels for a broad search like "Bali" are all budget homestays. Result cap, not a bug.
- Hotel cards show **no review scores** (TripGic's rating scale is undocumented).
- Hotel guest **age is sent as 30** for adults (TripGic requires a number; only child prices depend on it).
- Booking is **sandbox-only and admin-only**. Regular travellers see the "coming soon" state by design.
- **Cancel fails** in the sandbox by TripGic's own restriction; flight holds expire on their own at the end of the day (New York time).
- Hotel rates cannot be held, so a hotel booking needs the wallet funded at the moment of booking.
- A flight "held" order is expected while the wallet is empty. It is a successful reservation, not a failure.

## 13. Sign-off

| Role | Name | Date | Result |
|---|---|---|---|
| Tester / product owner | Andre Porozny | | ☐ Accepted for sandbox testing ☐ Accepted for launch |
| Build | Claude | 20 Sep 2026 | Automated suite: 38/38 |
