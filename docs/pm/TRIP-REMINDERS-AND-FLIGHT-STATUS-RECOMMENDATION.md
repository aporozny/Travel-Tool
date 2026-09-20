# Drift: Trip Reminders and Live Flight Status. Findings and Recommendation

20 Sep 2026. Two research agents: (1) flight-status data providers and supplier signals, (2) reminder schedule, channels, law and scheduler design (including an audit of the codebase). Prices and coverage figures come from vendor pages seen on the day and were not all verifiable; items marked *unverified* need checking. Not legal advice.

## 1. The short answer

Do it in two steps. **Step 1 needs no vendor at all and is worth building now**: a proper booking confirmation, a scheduler, and time-based reminders (7 days, 72 hours, 24 hours, 3 hours before). **Step 2 adds live flight status** (delays, cancellations, gates) once a data provider has been tested on real Bali flights. The reminder step also fixes a gap: **today Drift sends no booking confirmation email at all.**

## 2. What exists today (codebase audit)

- Email (`sendEmail`, SendGrid, plain text only) and SMS (`sendSms`, Mobile Message). Mobile Message only delivers to **Australian numbers**. The Twilio settings are unused and there is no Twilio package.
- **No scheduler of any kind.** Only two host cron jobs (location cleanup, sub-area resolve) and a container watchdog. Redis holds caches only and runs without persistence, so a job queue in Redis could lose jobs on a crash.
- **No push notifications:** the web app has no service worker or manifest, and the mobile app (bare React Native) has no push packages.
- **No timezone field** for users. Consent records exist but there is no unsubscribe mechanism. Phone numbers are unverified free text.
- **TripGic bookings store local times with no timezone and IATA codes only.** Duffel bookings store the IANA timezone and terminals. So TripGic times cannot be turned into exact moments until we add an airport-timezone table.
- **No Duffel webhook receiver exists.** The table for schedule-change events (`flight_order_events`) is empty and unused.
- A WhatsApp engine (WAHA) runs on the server but is unrelated to Drift and unofficial. **Do not use it for customer messages**; WhatsApp bans that. If WhatsApp is wanted, use the official business API.

## 3. Live flight status: providers

| Provider | Gate / terminal / belt | Push | Price seen | Notes |
|---|---|---|---|---|
| FlightAware AeroAPI | Yes (fields documented) | Alerts, about US$0.02 each | Standard plan US$100/month minimum; B2C explicitly allowed | Looks only 2 days ahead |
| AeroDataBox | "Subject to availability" | Free alert subscriptions | From US$19/month (40k units) | Own table: live status for Indonesia **23%**, Australia 66%, Malaysia 90%, Singapore 100%. Entry plans cache 7 days |
| Cirium / OAG | Claimed | Partly | Sales-led, opaque | Enterprise; for scale |
| AirLabs | Yes | Beta alerts | From US$19 | Coverage unpublished |
| Aviationstack | Partly | None found | From US$49.99 (free tier non-commercial) | Fallback only |
| Flightradar24 | No gate or terminal data | None | Cheap | Not suited |
| Amadeus Self-Service | n/a | n/a | n/a | **Retired 17 Jul 2026** |

Unverified for every provider: how often gates, terminals and belts are actually filled at Bali (DPS), Sydney, Melbourne and Brisbane, and coverage of Jetstar, AirAsia X, Scoot and Batik. **This is the deciding risk**, so test before committing.

**Supplier signals:**
- **Duffel** sends a signed webhook (`order.airline_initiated_change_detected`) when an airline changes a booking; the details come from a follow-up call. It arrives at least once, possibly out of order, so duplicates must be ignored. Which airlines it covers is undocumented.
- **TripGic** offers **no change alert, no change log and no webhook** (from its spec). Drift must check each booking daily from 14 days out, every 6 hours within 48 hours, and compare. Ask TripGic in writing about schedule-change notifications.

**What can honestly be promised:** delays and cancellations as the airline reports them; gate, terminal and baggage belt "when published", otherwise "Not yet announced" with an updated-at time. Gates usually appear 30 minutes to 2 hours before departure (forum-level evidence only, unverified for these airports). Never invent or infer a gate. Airline and airport screens are the authority.

**Recommendation:** launch on FlightAware, after a **2-week shadow test** against AeroDataBox on about 50 real Sydney/Melbourne/Brisbane to Bali flights, measuring how often each supplies gates and how accurate its delay times are. Negotiate Cirium or OAG only at scale.

**Cost (estimates, 30 checks per flight, before sharing):** about US$100/month for 100 upcoming flights (the plan minimum), about US$150 for 1,000, about US$1,500 for 10,000, less with sharing and volume discounts.

## 4. The reminder schedule (per flight leg)

| When | Content | Channel | Value |
|---|---|---|---|
| Booking | Confirmation, itinerary, passport check (valid 6 months beyond the trip) | Email, in-app | High |
| 7 days out | Entry checklist: passport, visa (e-VOA can be applied for up to 14 days ahead), Bali tourist levy | Email, in-app | Medium-high |
| 72 hours out | All Indonesia arrival card window opens, with the official link | Push, email | High |
| 24 hours out | Check-in likely open (rule differs per airline, unverified) | Push | Medium |
| 3 hours out | Terminal and leave-for-airport time; gate only if live data has it | Push, SMS | High |
| Any time | Delay of 30+ minutes, cancellation, gate or terminal change, schedule change | Push, SMS, email | Highest |
| Landing | Welcome and levy reminder; transfer offer only if opted in | Push, in-app | Medium |

Skip boarding calls (noise). Hotels: a check-in-day message with address and host contact (high value). About 6 messages per flight leg plus 0 to 2 alerts; roughly 4 of those would actually interrupt someone.

**Entry facts (Bali):** the levy is IDR 150,000 and e-VOA is IDR 500,000, valid 30 days, needing a passport valid 6 months from arrival (both from official Indonesian sites). Smartraveller advises the arrival card within 72 hours of travel and 6 months' passport validity from the date you leave (via search summary; the page itself timed out). **Not verified from an official page:** that the arrival card became mandatory on 1 Oct 2025 (only secondary sources) and the exemption rules for the levy. Do not hard-code any of this: keep a `travel_requirements` table with the text, source link, `verified_at` and `review_by`; a message whose fact is older than 90 days says "check the official link" instead; a weekly job flags changes to the source pages; every message shows an "as at" date and the source. Australian passports only until other nationalities are added.

## 5. Channels

- **Email:** near free, universal, slow to be read. On by default.
- **In-app:** free, no consent needed, only seen when the app is open. On by default.
- **SMS:** Mobile Message from about 1.6c each but **Australian numbers only**; Indonesian numbers need another provider (Twilio lists about US$0.44 per message). A traveller on a local eSIM may not receive SMS to their Australian number. Opt-in per trip, critical alerts only.
- **Web push:** free, but iPhone Safari needs the site installed to the Home Screen, so reach is low until Drift is an installable web app.
- **Mobile push:** best for time-critical alerts, but the app needs native Firebase/Apple setup and it is unclear whether the mobile app is shipping.
- **WhatsApp (official business API):** per-template pricing, needs templates and opt-in. Later phase.

## 6. Legal and policy checklist

- **Spam Act 2003:** consent, sender identification and a working unsubscribe. Any promotional content (such as a transfer offer) turns a message into a commercial one. Keep offers out of service messages, and make them opt-in with an unsubscribe that works within 30 days.
- Pure service messages (delay alerts, check-in) are not marketing but should still name Drift, give a contact and link to preferences. Get legal confirmation.
- **SMS sender ID:** the ACMA Sender ID Register has applied since 1 July 2026; unregistered alphanumeric sender names show as "Unverified". Check what Drift's sender name is and register it.
- Quiet hours (suggest 22:00 to 07:00 in the traveller's current timezone, urgent alerts excepted) are a policy choice, not a law as far as found.
- Never put passport numbers in a message. The Privacy Policy is already a go-live blocker.

## 7. How to build it (design)

- **Scheduler:** a Postgres table `scheduled_notifications` polled every 30 to 60 seconds, claiming rows so two workers cannot send the same one. Chosen over Redis because Redis here loses data on a crash, times change and need updating or cancelling, and volume is tiny.
- **Never send twice:** a unique key per segment, type and channel; each reminder has an expiry so a stale one is skipped rather than sent late; stuck "sending" rows are recovered.
- **Timezones:** at booking time convert local time plus airport timezone into an exact UTC moment and store the zone used. Duffel supplies the zone; for TripGic bundle an airport IATA-to-timezone table (the `mwgg/Airports` dataset, or the airline-route-data file you shared, which also carries timezones). An airport we cannot resolve blocks scheduling and alerts an admin, rather than guessing. Note DPS (Bali) is UTC+8, not Jakarta's UTC+7.
- **One alert per real change:** compare each status snapshot with the last one *notified*, not the last one seen. Notify on a departure move of 15+ minutes, terminal, gate or status changes, and cancellations; combine changes within 2 minutes; repeat a delay alert only after a further 30 minutes; at most 4 live alerts per segment; at most 6 SMS per trip.
- **Retry and fallback:** retry at 1, 5 and 15 minutes until the message expires, then fall back SMS to push to email; critical failures alert you.
- **Unsubscribe:** signed one-click link, `List-Unsubscribe` header, SMS STOP handling, all recorded in the consent table.

**Tables (columns summarised):** `trip_segments` (one row per flight leg or hotel stay, with UTC times), `notification_preferences` (per channel and category, quiet hours, language), `push_subscriptions`, `scheduled_notifications`, `notification_deliveries`, `segment_status_snapshots`, `travel_requirements`.

## 8. Test scenarios

1. A delay pushes landing after midnight: the local date shows "+1" and the landing message moves.
2. Booked 2 hours before departure: confirmation plus one "leave now" message; the 7-day, 72-hour and 24-hour reminders are skipped.
3. Cancelled flight: pending reminders cancelled, one alert sent, no landing message.
4. Opted out of SMS: no SMS; alerts fall back to push or email; STOP is honoured.
5. Sydney daylight-saving change between booking and flight: the 24-hour reminder still lands correctly.
6. Wrong or missing airport timezone: scheduling blocks and an admin is alerted.
7. A provider flip-flops (20, 25, 20, 45 minutes late): at most 2 alerts.
8. A restart or two workers during a send: no duplicates.
9. A 3am Bali delay for a 6am flight: non-critical alerts wait, critical ones go.
10. A duplicate or out-of-order Duffel webhook: ignored.

## 9. Effort

- **Step 1** (confirmation email, segments, scheduler, preferences, reminders by email and in-app, entry-requirements content): about 2 weeks.
- **Step 2** (live status provider, Duffel webhook receiver, TripGic checks, change detection): larger, after the shadow test.
- **Later:** SMS to international numbers (M), web push (M), mobile push (M-L), official WhatsApp (L).

## 10. Decisions needed from Andre

1. Start Step 1 now (it needs no supplier decision)?
2. Live status: is a 2-week side-by-side test of FlightAware and AeroDataBox on real Bali flights acceptable, and what is the most you would pay per flight?
3. SMS: Australian numbers only, or accept about US$0.44 a message for Indonesian numbers?
4. Will you ask TripGic in writing about schedule-change notifications?
5. Is the mobile app shipping, or is this web-first (an installable web app for push)?
6. What is the sender's legal name and ABN, and is the SMS sender name registered?
7. Is there a marketing-consent checkbox at signup, or do offers stay off until we add one?
8. When do real bookings start? All 6 current TripGic orders are sandbox holds.
