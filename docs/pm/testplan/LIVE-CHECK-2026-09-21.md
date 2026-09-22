# Live check of the code-reading defects, 21 Sep 2026

The five test-plan parts (A to E) found defects by **reading code**. This is the first pass that **ran real requests** against the live app, using only the seeded `@drifttest.com` accounts (no real user data touched, nothing sent to anyone, SOS never called). Script: `backend/scripts/` in the repo history (`live_sweep.js`, run inside the backend container).

## Reproduced with a real request

| Defect | What happened | Status now |
|---|---|---|
| D-A-2 Profile preference chips never save | `PUT /travelers/me/preferences` returned **404 Route not found** (the API only has GET and PATCH) | **Fixed** 21 Sep (screen now sends PATCH; a failed save puts the chip back) |
| D-B-3 Reviews | `GET /reviews/me` and `GET /reviews/operator/:id` both returned **500** (`reviews.title` column does not exist) | **Fixed** 21 Sep (migration 043 adds `reviews.title`) |
| D-C-5 Private posts | Posting with visibility `private` returned **500** (database only allows public / members / connections) | **Fixed** 21 Sep (migration 043 allows `private`; posts are now hidden from everyone but the author) |
| D-C-3 Photo upload | A 1 MB photo returned **413 Payload Too Large** (JSON body limit is 10 KB, nginx has no upload size or `/uploads` route) | **Fixed** 21 Sep (route-specific 14 MB body limit, nginx `client_max_body_size` and `/uploads/` route, uploads folder owned by the backend user, real-image check) |
| D-D-3 Plan a trip | Date-only dates returned **400** | **Fixed** 21 Sep (dates now accepted, region and public flag stored) |
| D-D-4 Missed check-ins | No trip has ever been marked overdue or escalated; there was no scheduler | **Fixed** 21 Sep (monitor built, see below) |
| D-D-2 "Share my location now" crash | Could not run: needs Trip Mode consent (403). Confirmed by code: the API returns only `{id, recorded_at}` and the screen read `.latitude` | **Fixed** 21 Sep (screen uses the coordinates it sent) |
| Photo proxy crash (`?ref=%25`) | Confirmed by code; fixed 20 Sep; live check returns 400 and the server stays up | **Fixed** |

## Correction to the plan

- **D-C-4** ("a post with a photo and no text returns 500") is **wrong as written**: the server answers **400** (validation requires text). Photo-only posts are still impossible, but it is a clean rejection, not a crash. Severity should be lowered.

## Not yet run

Everything that needs a browser (all clicking), operator accounts (dashboard, claims), other people's data, and the community comment/reaction routes (the feed is empty for test accounts, so there was no post to comment on; they remain "confirmed by code reading").

## Fixed in the same pass

- **Book both flights** (D-E-1, D-E-2): the second booking now starts clean, and the first confirmation stays on screen.
- **Duffel passenger validation** (D-E-3): email and international phone number are checked **before** the card is charged.
- A crash in any screen now shows a recovery page instead of a blank app (there was no error boundary anywhere).

## Missed check-in detector (new)

Every minute an active trip whose check-in is more than 15 minutes late becomes `overdue` and the Drift safety reviewer is paged (email, and SMS because it is urgent) with who, where, how late, last check-in and last shared location. If it is still overdue after 60 minutes, the reviewer is told a second time. **Emergency contacts are NOT messaged automatically**: that stays off until the owner sets `SAFETY_NOTIFY_CONTACTS=on`, because it sends messages to real people. When it is on, contacts get a calm message ("may only mean a flat battery ... contact the local emergency services if worried") and an all-clear if the traveller then checks in. Seeded test accounts go through every state change but nobody real is ever alerted. Verified end to end (21 checks) on a test account.

Note: the reviewer *email* will not arrive while SendGrid is out of credits; the SMS still does.


## Also fixed 21 Sep (found by reading the code while fixing the above)

- **Community comments** returned 500 on add, list and delete: the code used `author_id`, the table column is `user_id`. Fixed, and comments on a post the viewer cannot see are now refused.
- **Community reactions** returned 500 on add: the code named a uniqueness rule the table does not have. A member has one reaction per post; the same reaction again removes it, a different one replaces it.
- **Private / connections posts could be read by anyone with the post id** (post detail and its comments ignored visibility). Now checked on every read, react and comment.
- **`my_reaction` was never returned** on Discover and post detail (those routes never looked up who was asking).
- **Photo-only posts** now work (the database required text).
- **Attached photo URLs** must now be ones our own upload created (anything else is a 400).
- Test: `backend/scripts/community-fixes-api-test.js`, 38 checks, all passing.


## Operator side, fixed 21 Sep (second pass)

| Defect | What was wrong | Fix |
|---|---|---|
| D-D-1 Operator dashboard never loads | `/dashboard/bookings` joined a table that does not exist (`traveler_preferences`), `/dashboard/reviews` used the missing `reviews.title`; `Promise.all` then blanked the whole screen | Bookings joins `member_preferences`; reviews fixed by migration 043 and now `LEFT JOIN`s bookings; the screen uses `allSettled`, shows what loaded, says what did not, and has a Try again button |
| D-D-7 Reviews API broken | `reviews.title` missing | Migration 043 (first pass) |
| D-D-8, D-B-1, D-B-2 Listing claims (submit, list, admin queue, approve) | `listing_claims` lacked `operator_id`, `evidence`, contact and review columns; code used `place_cache_id` where the column is `place_id`; approval called a database function that does not exist and never set `is_claimed`; `search.ts` had a second, different copy that wrote a non-existent `claimed_at` | Migration 044 adds the columns, a status check and a unique index (one pending claim per operator per listing). One shared service (`services/listingClaims.ts`) now backs both route files. Approval marks the listing claimed, verifies the operator, sets the trust score (identity 100, composite 40, tier "verified") and rejects rivals still waiting on the same listing. The two already-verified operators were given trust rows |
| After a page reload `user` is null (operators and admins lose their menus; a traveller mid-onboarding skips onboarding) | Only the token was restored, never the user | New `GET /auth/me` (mounted before the sign-in rate limiter so reloads never count against it); `App.web.tsx` waits for it, signs out only on 401/403, and shows a Try again screen if the server cannot be reached |
| D-D-5 Admin link is a 404 | nginx redirected `/admin` to `/admin.html`, which the "html files must exist" rule then answered with 404 | nginx serves the app for `/admin` and `/admin.html` (the app already draws the admin screen for any `/admin` path); sidebar link now opens `/admin` |
| D-D-28 Operator Bookings tab shows blanks | The screen printed `business_name`, which the operator query does not return, and had no actions | The operator's Bookings menu item opens the dashboard's Bookings tab (traveller name and email, Confirm, Decline, Mark completed) |
| D-D-42 Dashboard status changes swallow errors | `console.error` only | A failed Confirm or Decline shows the server's message |

Tests: `backend/scripts/operator-fixes-api-test.js` (59 checks, all passing, cleans up after itself). Also checked in a real browser on the live site: a reload keeps the operator and admin menus, the operator Bookings tab lists the booking and Confirm works, `/admin` loads.

Found by the browser check and fixed before finishing: the operator's Bookings item first stayed on the Overview tab because React reused the same screen (fixed with a `key`).


## Duffel checkout: charged with no booking, fixed 22 Sep (D-E-4, and a worse problem found while fixing it)

**What the test plan recorded (D-E-4):** if the order step failed after the card was charged, the screen went back to the card form, paying again could not work, and there was no retry.

**What reading the code showed was worse:** the server kept no record of any payment. The browser held the only link between "the traveller paid" and "place the order", and `POST /flights/orders` never checked the payment at all: it trusted whatever `paymentIntentId` the caller sent, while the order is paid from **Drift's own Duffel Balance**. So once the Duffel key is live, anyone could have called that route with a made-up payment id and been booked at Drift's expense. (It was safe only because the route is admin-only while the key is a test key.)

**Fix (migration 045, `services/flightPayments.ts`, `services/flightPaymentRules.ts`):**

| Before | Now |
|---|---|
| No record of a payment | Every payment intent is recorded in `flight_payments` when it is created (user, fare, amount, status) |
| Order placed for any payment id | An order needs a payment that is recorded, belongs to that user, is for that fare, was confirmed paid, and is unused. Made-up or someone else's id is a 404 |
| Fare taken from the caller | The fare comes from the payment record; a mismatch is refused |
| Two clicks could double-book | The payment is claimed atomically; a repeat call returns the same booking; one order per payment is enforced by a unique index |
| Bad phone or passenger list found only after the card was charged | Passengers are validated (and kept) when the payment is created, before the card step |
| Order fails after payment: dead end | The screen says the payment is safe, offers **Try again** (no new charge) and **Ask for a refund**; retries are limited to 3 |
| Fare rose above what the card paid | Nothing is booked at a loss; a refund is needed |
| Airline booked it but our recording failed | The order id is kept; a retry finishes recording and never books twice |
| Nobody told | The owner is alerted immediately (SMS as well when a person must act), and a 5-minute reconciler catches payments that sat unfinished (closed browser, server died mid-order, card captured but never confirmed) |
| Closed the browser | "A payment needs attention" panel on the Flights and Bookings pages |

**Refunds are still manual.** The Duffel SDK has no refund call for card payments, so a refund is done in the Duffel dashboard and then recorded with `POST /api/v1/flights/payments/:id/mark-refunded` (admin). The alert email says exactly this.

**Tests:** `tests/flightPaymentRules.test.ts` (17, run in CI) and `backend/scripts/flight-payments-api-test.js` (72 checks against the real database with a fake Duffel and a fake alert channel: happy path, double submit, every failure kind, retry limit, price change, unrecorded order, reconciler, and the HTTP routes). Older suites re-run with no regressions.

**Not verified end to end:** the real Stripe card step and a real Duffel confirm/order, which need a browser and a Duffel test payment. Everything on our side of those two calls is tested.


## TripGic held bookings never updated, fixed 22 Sep

**The defect:** the only code that re-read a booking from TripGic ran from `GET /tripgic/orders/:id`, which no screen calls (the plan noted this in its route table). A booking that was "Reserved" stayed reserved for ever: nothing noticed a moved deadline, a ticket issued later, or a cancellation by the supplier, and a booking nobody listed never expired. At the time of the fix 9 test bookings were "held", every one with a ticketing error, some long past their deadline.

**What TripGic really says (read from its sandbox on 21 Sep, nine bookings, fresh and long past deadline alike):** `booking_status: "hold"`, `ticket_status: "inQues"`, `payment_status: "pending"`, plus `auto_cancel_timestamp` (seconds since 1970, UTC). Two findings shaped the fix:
- TripGic **never flips a booking to expired or cancelled by itself** when the deadline passes, so Drift has to expire it.
- The **stored deadline can be out of date**: one booking had 03:59 UTC on our side but 13:45 UTC at TripGic. Expiring by the stored deadline would have cancelled a live reservation.

**Fix (migration 046, `services/tripgicOrderSync.ts`, `services/tripgicStatus.ts`):**

| What | How |
|---|---|
| Refresh | Every 10 minutes (and when a traveller opens Bookings, in the background) held bookings are re-read from TripGic: deadline, ticketed, cancelled |
| Expiry | A held booking is expired only after its deadline has been confirmed with TripGic within the last 30 minutes, or is more than 2 hours old (so nothing stays held for ever if TripGic is unreachable). Opening Bookings checks overdue ones first, waiting at most 3 seconds |
| Never ticketed | The owner gets ONE digest alert ("N bookings are reserved but not ticketed", labelled [TEST] for sandbox bookings) for a reservation whose ticket was never issued, with the fix in the email |
| Ticketed bookings | Checked hourly until the trip is over. If TripGic says one is cancelled the owner is alerted (urgent for real bookings) and **nothing is changed automatically**, because the wording TripGic uses for ticketed/cancelled has never been seen |
| Learning the wording | Every status TripGic reports is stored on the order (`supplier_status`); unrecognised wording is logged once |
| Admin ticketing | `POST /api/v1/tripgic/orders/:id/issue-ticket` (admin): refreshes first, refuses if it is no longer held, past its deadline, a stay, or already ticketed, then issues the ticket and records what TripGic calls it. Use it once the wallet is funded |

**First real run (21 Sep, 15:40 UTC):** the job refreshed all nine held bookings, expired three whose real deadlines had passed, and sent the owner the digest.

**Tests:** `tests/tripgicStatus.test.ts` (10, CI, using the real observed values) and `backend/scripts/tripgic-order-sync-api-test.js` (46 checks with a fake TripGic and fake alerts against the real database; it restores every existing booking afterwards). The older TripGic order suite (46 checks) re-ran with no regressions.

**Also fixed:** `auth.test.ts` and `operators.test.ts` failed their cleanup against the live database (the new consent-records table blocks deleting their temporary users), leaving `@example.com` users behind. CI did not show it because CI's older schema has no such table. They now clear consent records first. Five leftover users from two suite runs were removed.

**Still true:** the words TripGic uses for a ticketed booking are unconfirmed until a booking is actually ticketed (the wallet has never been funded). After it is, run one `issue-ticket`, then read `supplier_status` and tighten `tripgicStatus.ts`.


## Operators had no way to create a business listing, fixed 22 Sep (D-A-3, D-DSH-08)

**What was actually broken:** `POST /auth/register` only creates a `travelers` row for role `traveler`. An operator account gets **no profile row of any kind** -- confirmed live: two real accounts (`jporozny@hotmail.com`, `operators@drifttravel.app`) have neither an `operators` row nor a `travelers` row, exactly what a fresh registration produces today. The consequences, both already in the test plan:
- **D-A-3:** the Profile tab is shown to operators but calls `GET /travelers/me`, which 404s for them, so it shows "Loading..." forever.
- **D-DSH-08:** the Dashboard says "No operator profile found. Create your listing first." with no button anywhere to do that.

There was no operator claim-listing button either (D-B-5), but that was secondary: without a way to create or claim a listing at all, a brand-new operator account was a dead end past login.

**Fix:**
- New `GET /api/v1/operators/me`: the signed-in operator's own listing, or a clean 404 if they have not created one.
- `web/src/screens/OperatorProfileScreen.web.tsx`: replaces the traveller Profile screen for operator accounts (`AppShell.web.tsx`). Shows a create form when there is no listing (`POST /operators`), an editable view once one exists (`PATCH /operators/:id`), and the claim-an-existing-catalogue-listing flow underneath (search via `GET /operators/search-places`, submit via `POST /operators/claims`, own claims via `GET /operators/claims` -- all already working from the earlier claims fix). A bare domain typed into Website is completed to a full URL before it is sent, since the API requires one.

**Verified with a real, throwaway operator account with no operators row (the exact scenario), in the live browser:** Profile showed the create prompt instead of spinning; created a listing; it appeared correctly, including the completed website URL; the Dashboard, unreachable before, now shows the new listing (0 bookings, correctly empty); searched the real catalogue, claimed an unclaimed real place ("Debbie's"), saw it move to "Claim pending" and appear under "Your claims". Everything created by the check was removed afterwards, including the claim, so the catalogue place is unclaimed again.

**Tests:** `backend/scripts/operator-listing-api-test.js` (18 checks: no-listing 404, role checks, validation, create, duplicate-create refused, edit, ownership, two operators kept separate). The earlier `operator-fixes-api-test.js` (59 checks, claims/dashboard) re-run with no regressions.

**Not done:** there is still no in-app way to fix the two real accounts named above -- the owner can now do that themselves by signing in as each and using Profile > Create your listing, once they have the login details. Nothing was created or changed for either account by this fix.
