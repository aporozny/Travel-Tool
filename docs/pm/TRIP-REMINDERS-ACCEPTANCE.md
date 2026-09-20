# Trip Reminders (Step 1): what was built and how to accept it

20 Sep 2026. Email and in-app reminders for booked flights and hotels. **No live flight status yet** (delays, gates): that is Step 2. Design and research: `TRIP-REMINDERS-AND-FLIGHT-STATUS-RECOMMENDATION.md`.

## What it does

| When | Message | Channel |
|---|---|---|
| Booking is made | Confirmation: itinerary, references. A held reservation says the ticket is **not issued yet** and promises an email when it is | Email, in-app |
| Held becomes ticketed / confirmed | "Your tickets are issued" | Email, in-app |
| 7 days before departure | Entry checklist (for Indonesia/Bali: passport validity, e-VOA, levy, each with its official source) | Email, in-app |
| 72 hours before | Arrival-card reminder | Email, in-app |
| 24 hours before | Check-in usually opens; have passport and reference ready | Email, in-app |
| 3 hours before | Time to head to the airport; check the departure board for your gate | Email, in-app |
| Hotel check-in day | Address, reference, confirmation number | Email, in-app |

Rules built in: a reminder whose window has passed is **skipped, never sent late**; a booking made 2 hours before departure still gets the "time to leave" message; a cancelled or expired booking withdraws everything pending; **no gate or terminal is ever stated**; unchecked entry rules only point to the official site; test (sandbox) bookings are labelled **[TEST]** and only ever notify admin accounts; every email has a one-click unsubscribe (also recorded as a consent change).

## Where to see it

- **Bookings tab**: "Trip updates" (your in-app reminders, with "Reminder settings" to switch email and in-app on or off) and, on each trip card, the reminders still to come.
- Admin tools (API, admin only): `POST /api/v1/notifications/admin/test-send` sends any one message for a real booking **now** to your own account email; `/admin/backfill`; `/admin/process`.

## BLOCKER: email is not being delivered

SendGrid rejects every send with **"Maximum credits exceeded"** (HTTP 401). The key itself is valid and has send permission; the account's email quota is used up. Until that is fixed **no email leaves Drift**: not these reminders, and not the Safety Line's alert emails, which use the same account. In-app reminders work regardless. Fix: sign in to SendGrid and check the plan and credits (or move to another provider). Reminders whose email failed are retried 3 times over 20 minutes, then marked failed; they are not re-sent later (a stale reminder is worse than none).

## Automated checks (all passing)

- 133 unit tests (`npm test`), of which 38 are new: time-zone conversion incl. daylight-saving and Bali (UTC+8), reminder planning, message wording, entry-rule freshness, unsubscribe links, who is never emailed.
- `backend/scripts/trip-notifications-api-test.js`: 26 checks end to end against the live sandbox (booking, legs, scheduling, no duplicates, the sender, suppression, lapsed hold withdrawing reminders).
- `backend/scripts/tripgic-orders-api-test.js`: 46 checks, still passing with the new hooks in the booking code.

## Manual acceptance (yours)

| ID | Do this | Expect |
|---|---|---|
| R-1 | Book a test flight (Flights tab, admin). Open **Bookings** | A "Trip updates" entry titled **[TEST] Your seats are reserved**, and the trip card shows a Reminders list with dates |
| R-2 | The trip card times | Departure and arrival are the local times at each airport, and a next-day arrival shows its date |
| R-3 | Open "Reminder settings", untick email, reload | The setting stays off; back on works |
| R-4 | Once SendGrid is fixed: book a test flight | The confirmation arrives at your account email, subject starting **[TEST]**, with a working "Stop trip reminders" link |
| R-5 | Click that link, then the button | "You're unsubscribed"; Reminder settings shows email off |
| R-6 | An email opened on a phone | Readable, button visible, no horizontal scroll |
| R-7 | Wait for a reminder's moment (or use test-send) | Arrives once, never twice |
| R-8 | A test booking whose hold lapses | Its reminders disappear from the card |
| R-9 | Bali trip, entry checklist email | Passport, e-VOA and levy shown with their official links; the arrival card only says to check the official site |

## Known limits

- Email needs SendGrid fixed (above). No SMS or push yet (Step 3).
- Only Indonesia has entry rules; other destinations get a pointer to Smartraveller. Rules carry a "last checked" date and fall back to "check the official site" after 90 days: **someone must re-check them**.
- The arrival-card rule (mandatory or not, and the 72-hour window) is not confirmed from an official page, so it is not stated as fact.
- Hotel reminders only work for Indonesian hotels (time zone by longitude); other countries get none rather than a wrong time.
- Quiet hours are stored but not enforced yet (only email and in-app exist so far).
- Sender name and contact use the existing `safety@drifttravel.app`; a dedicated trips sender, the legal entity/ABN in the footer, and Spam Act legal confirmation are still to do.
