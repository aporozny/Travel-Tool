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
