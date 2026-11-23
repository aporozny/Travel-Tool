# Drift: current status

Last updated: 23 Nov 2026. This is the single source of truth. Update it whenever a decision is made or work finishes. Written from the Claude Code side plus the claude.ai ad-copy document; items marked **(unverified)** came from memory or documents not re-checked.

## Launch

Drift is launching worldwide.

### Deployed and verified
- Location history purge job: Trip Mode location history deleted 7 days after it is recorded (PR #9; migration 035).
- Privacy policy and terms say 7-day retention (PR #10).
- Consent banner: Meta Pixel loads only after Accept; privacy policy updated for worldwide use incl. EEA/UK rights, legal bases and transfer safeguards (PR #11).
- Fonts self-hosted, no Google Fonts requests (PR #12).
- `deploy/deploy-web.sh` one-command website deploy (PR #13). Its first run on the VPS has not been done yet.
- Safety Line tested end to end several times by the owner; works.
- Uptime check "Drift places health" on `/health/places`, with email and SMS alerts. A $50 monthly Google billing alert exists.

### Open
- A lawyer should review the privacy and terms page, including the EU/UK rights wording and the seller-of-travel position.
- `TERMS_VERSION` in `backend/src/routes/auth.ts` is still `terms_of_service_v0.2` although the Terms changed.
- Cause of the earlier Cloudflare 530 outage was never found.
- Old backups `web/dist.bak-4nov` and `web/dist.bak-5nov` on the VPS can be deleted.
- CI was failing on 2 lint errors **(unverified, check)**.
- Later: scan Safety Line call transcripts (`sos_ai_calls`) with a local script once there is real call volume. Do not send transcripts to a third-party session store (privacy).

## TripGic (flights, hotels and other products)

Sandbox only. Base `https://serviceapi.tripgic.com`, headers `apikey` + `secretecode`. Docs: https://developer.tripgic.com (portal launched 2026-11-15; changelog has no change list). On 23 Nov TripGic said the sandbox balance was topped up, and asked for a screenshot of the `/hotel/cancel-booking` error.

Test plan: `docs/pm/TEST-AND-ACCEPTANCE-PLAN-TRIPGIC.md`.

### Left to test (hotels and flights)
- F-20 flight ticketing with a funded wallet. Then read TripGic's real "ticketed" wording and tighten `backend/src/services/tripgicStatus.ts`.
- H-13 hotel confirmed with a funded wallet.
- Cancel re-test on a fresh hold. Our request matches their doc (`member_id`, `tracking_id`, `reason`), so the failure is not a field-name problem. Capture the logged `TripGic cancel failed for <id>:` reason for TripGic. (Logs had rotated on 23 Nov; a new attempt is needed.)
- Move test dates forward (plan uses 15 Nov 2026, now past).
- Manual browser tests: F-10, F-12, F-14 to F-17, F-19, F-22, H-10, H-11, H-14, O-02, O-06, O-07, R-01 to R-08. R-09 never exercised. O-04 needs customer payments.
- Hotel endpoints not used yet: `/hotel/get-hotel-details`, `/hotel/cancellation-policy`, `/hotel/rooms-price-comparison`.

### Launch gates for booking
Stripe card payment before supplier booking plus a refund path; USD vs AUD decision; TripGic per-transaction fee ($2 to $10) in the markup (rule today: 8%, min $5, max $150); legal review; support process; alerts (low wallet, failed ticketing); rollback by unsetting `TRIPGIC_PAYMENT_MODE`. Until then booking is admin-only.

### Other TripGic products (assessed from docs on 23 Nov, endpoint details not yet read)
Same auth and same search, validate, update travellers, create booking pattern as ours.
- Best fit: eSIM (13 endpoints), Activity (6), Transfer (6). Also useful: Bookings API (`/booking-list`, `/booking-details`, `/booking-processing-verify`, `/reports/service-status`).
- Good fit with care: Travel insurance (5; regulated in Australia), Car rental (6).
- Medium: Visa (11), Tour package (11). Low: Train (9), Business lounge, Fast track, Meet and greet (5 each).
- Suggested order: finish hotel and flight testing, then eSIM, Transfer, Activity.

## Marketing and ads

Meta (Facebook and Instagram) account exists; TikTok account exists; Buffer is dropped. No ads have run yet. No TikTok pixel on the site; if added it must wait for the banner's Accept.

Source: claude.ai artifact "Drift Ad Copy: Deals, Safety, Share Everywhere" (26 Oct 2026), based on the "Drift Launch Plan" doc of 12 Oct 2026 (not yet read). Other claude.ai items not yet read: task "Drift Social Automation Design" (14 Nov), artifact "Drift Meta Ads" (21 Nov).

- Three ad sets for Australia, ages 21 to 45 cold: Set 1 "Travel smarter, spend less" (sign-ups); Set 2 "Travel safer" (ads 2A to 2C use features that work today: free SOS, emergency contacts, emergency numbers for 30+ countries); Set 3 "Post once, share everywhere".
- On hold: ad 2D (needs Safety+ missed-check-in alerts, not built); Set 3 (needs blog-to-socials sharing, not built); any "cheaper" or "save X%" ad (no member rates exist).
- Budget split while Set 3 is on hold: solo traveller ads 30%, Set 1 40%, Set 2 30%. Review after 7 days; pause anything over twice the average cost per sign-up.
- Needed before launch: two landing pages (deals; safety with the "not an emergency service" line); upload the member email list to Meta for exclusions; visuals 1080x1080 and 1080x1920.
- Retargeting audiences built from site visits will be small because the Pixel counts only visitors who accepted the banner.
- Rules: see `CLAUDE.md` (brand and ad rules).

### From the claude.ai chats (Oct to Nov 2026, relayed by the owner, not re-checked)
- Ad images exist: claude.ai Design file "Drift Meta Ads" (7 artboards: square for 1A, 2A, 2C and solo travellers; story for deals, free SOS and solo travellers). Text and graphics only, no place names. Needs export as PNG and upload in Ads Manager.
- Suggested starting budget about A$20 a day: A$8 set 1, A$6 solo travellers, A$6 safety. Campaign objective Leads, conversion event CompleteRegistration.
- **Fix before paying for ads:** the homepage testimonial is from "Andre" about a Nusa Penida dive operator. A founder review shown as a member review is a fake-review risk under Australian Consumer Law, and it names a place. Replace it with a real member quote or label it as from the founder.
- **Pixel check:** in Meta Events Manager use Test Events on drifttravel.app and confirm PageView and CompleteRegistration appear (accept the banner first, or nothing fires). If CompleteRegistration is missing, it must be added to the sign-up code.
- Meta Business Suite checks: Facebook Page and Instagram connected, ad account with a card, drifttravel.app domain verified.
- New sign-up alert (email and WhatsApp per sign-up, daily total at 8pm) is half done: n8n's database login points at a dev pipeline database, not Drift's, so n8n cannot see Drift sign-ups yet. Needs a read-only look at Drift's user table and a new n8n database login.
- Social posting hub (brand posts, n8n) as of about 30 Oct: nothing has posted yet. Blockers: expired Gmail login in n8n; Facebook cannot post automatically (Meta refused app access to the Drift Travel page, so it is an assisted channel); X login for @drifttravelau not created in n8n; one test row in the Drift posts table is marked `publish_failed` and needs setting back to `approved`. Instagram, LinkedIn, Threads, Bluesky and Pinterest not started.
- **Security:** a Facebook access token was pasted into a chat on 29 Oct. It must be revoked (remove the app connection or generate a new token).
- This hub posts Drift's own brand content. The member feature (share a Drift blog post to their own socials) is a separate build, not started.
- n8n (n8n.quantms.com.au) ran on the server that also hosts Drift (PMX-AndreOC01) and went down on 11 Nov because of a cable fault. Check that its tunnel and containers are up before relying on any n8n alert.

## Product plan (from claude.ai docs, not re-checked against the code)

Sources, all in claude.ai Artifacts: "Drift Launch Plan: Free Community, Paid Safety" (12 Oct 2026), "Drift Travel Agent Design" (12 Oct), "Social Posting Hub: PRINCE2 Project Pack" (6 Nov, last change record 29 Oct), "Drift Privacy & Terms Draft" (31 Aug), "Trip Mode QA Plan" (2 Sep). The older "drifttravel.app" claude.ai Project holds four chats from June and July and has no instructions or files.

### Free vs paid (decided 12 Oct)
- Free: community, Explore, search, messaging, AI travel agent, SOS button, emergency numbers (56 numbers, 30+ countries), 1 emergency contact, manual check-ins.
- **Drift Safety+, A$50 a month or A$450 a year** (decided; the doc itself says this is far above competitors such as Life360 Gold at A$15.99): scheduled check-ins with automatic alert if missed, escalation ladder (you, then contacts by email and SMS, then embassy details), live location for family, trip plan watch, Get me home, SMS alerts, unlimited contacts. Fully automated, no human monitoring centre at launch.
- Ideas listed in the plan to make the price hold: cover up to 4 travellers per plan, 7-day trial, a founding-member price (for example the first 500 at A$29 a month), a human monitoring layer later. Open questions still unanswered in the doc: group cover or single, trial or none, founding price, GST registration and ABN for Stripe, which lawyer.
- The planned launch date was 5 Nov 2026 (free signup and Safety+ together). That date has passed; free signup is open, Safety+ is not live.
- Build workstreams: A harden (secrets, key rotation), B open signup (waitlist gate removed, Turnstile, rate limits), C Safety+ engine (separate `traveller-worker` container, missed check-in scheduler, 60 second loop), D Stripe subscriptions (Checkout, webhook, `requireSafetyPlus`), E legal, F launch. **Whether C and D are built is not confirmed here; check the code.** The missed check-in scheduler was called the biggest build item and "does not exist yet" as of 12 Oct; the ad copy of 26 Oct still treats it as unbuilt.
- **Conflict to resolve:** the plan keeps location history 48 hours (free) and 30 days (Safety+). We set a flat 7 days for everyone on 23 Nov (PR #9 and #10). Decide which is right and make the code, the privacy policy and the plan agree.

### Ask Drift (AI travel agent), designed but not confirmed built
In-app chat, web first. Jobs: destination ideas from Drift's place catalog, and a stopover calculator. Emergency keyword check runs before the AI; visa, entry and medication rules are never stated as fact (links to official sites). Claude Sonnet via the Anthropic API, about US$0.10 per conversation, limits of 40 messages per member per day and a US$10 a day overall cutoff. Free during the beta. Launch blockers named in the doc: Google Maps Platform terms on sending Places content to an AI and on how long the places cache keeps data (the current cache may already break the terms); legal advice on misleading-conduct risk (ACL s18); a sourced list of emergency numbers per country; confirm signup enforces 18+.

### Social Posting Hub (brand posts via n8n), decisions
Gate 0 approved 29 Oct: brands Drift, The Pasta Lab Osteria, Tapasita, fullcb.com.au; build Facebook and X first; Reddit is an assisted channel. Decision D7 (29 Oct): Drift Facebook runs as an assisted channel (the workflow emails the approved text and the owner posts it by hand) because Meta access to the Drift Travel Page could not be set up. X posting costs about US$0.015 per post and US$0.20 per post with a link (every Drift draft has a link); no X credits bought and not approved to spend as of 29 Oct. Standing rule restated: confirm the plan before executing.

## Planned, not built
- Safety+ (family alerts on a missed check-in).
- Blog post sharing to connected social accounts (Facebook and Instagram need business or creator accounts; TikTok needs approval; X charges for API posting).
- Member rates on flights, hotels and activities.
