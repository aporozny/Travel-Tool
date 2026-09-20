# Drift: Traveller Blog, Confirmed Visits and Moderation. Findings and Recommendation

20 Sep 2026. Five research agents looked at this in parallel: (1) the existing codebase, (2) media and video hosting, (3) content moderation, (4) the visit-verification agent, (5) legal, consent, rewards and social sharing. This file is the combined result. It is research, not legal advice, and prices and legal points marked *unverified* need checking before anyone relies on them.

## 1. The short answer

The idea is sound and about half of it can be built on what already exists. **But the foundation under it is not ready.** The community feed the blog would sit on has real defects today, and there is no content moderation at all. So the recommendation is to **repair the base first, build moderation before anything becomes public, and treat video as its own later phase.**

## 2. What already exists (reuse)

- Community feed: `community_posts`, `post_media`, reactions, comments (`routes/community.ts`, `CommunityScreen.web.tsx`).
- Member-added places (`services/memberPlaces.ts`, dedup by name plus 150 m, capped at 5 new places a day).
- Consent records (`services/consent.ts`, append-only), reports and blocks, ban table, email and SMS alert to the reviewer (`sendReviewerAlert`).
- Operator "Verified" badge (`ExploreScreen`, `DashboardScreen`), set only in the operator-claim approval.
- `tripgic_orders` holds hotel bookings (name, dates, coordinates), so a Drift hotel booking can auto-verify a stay. Today it has only 5 sandbox flight rows.
- The Anthropic SDK is already used in the voice worker. ffmpeg 6.1 with x264 is on the server.

## 3. What is broken or missing today

**Broken (fix first):**
- **Photo upload does not work end to end.** The route takes base64 in JSON but the JSON limit is 10 KB; nginx has no upload size setting (1 MB default) and no `/uploads` route; the folder is root-owned while the app runs as another user. Result: 0 media files, 1 post in total.
- **Private posts are readable by ID.** `GET /posts/:id` ignores visibility, hidden flag and blocks. The feed and discover also ignore `is_hidden` and blocks.
- **Schema drift.** The live database differs from the migrations and the code (e.g. comments use `user_id`, code uses `author_id`; code sends visibility `private`, which the database rejects). Comment reads and writes probably fail.
- **Unsafe media handling.** Client-declared file type is trusted, no magic-byte check, no EXIF stripping (GPS leaks), `mediaUrls` accepts any string.
- Redis (no password) and Postgres are published on all network interfaces with the host firewall off. **Verified not reachable from the internet**, so only the local network and Tailscale can reach them. Bind to localhost anyway.
- The admin page builds HTML from unescaped text (`admin.html`); a moderation queue built on it must escape everything.

**Missing:** any moderation, video handling, a job queue, post and comment reporting and takedown, public share pages with Open Graph tags, per-post consent storage, share buttons, the verification agent, rewards, and terms wording that lets Drift use content on its own social channels.

## 4. Recommended plan

**Phase 0. Repair the base (S, 1-2 days).** Fix photo upload (multipart, nginx limit and `/uploads`, permissions, magic-byte check, re-encode and strip EXIF), visibility, hidden and block filters, a migration that reconciles the schema drift, rate limits on posting and uploading, validate `mediaUrls`, bind Redis and Postgres to localhost.

**Phase 1. Moderation, then the blog (M, 2-3 weeks).**
1. Moderation first: nothing becomes public until checked. New posts are saved as `pending`.
2. Blog: title, slug, long body, status, per-post consents, share buttons, a server-rendered public page with Open Graph tags (the site is a single-page app, so crawlers see nothing today).
3. Terms and Privacy update.

**Phase 2. Confirmed visits and rewards (M).** Automatic confirmation from paid Drift hotel bookings, a review queue for the rest, the badge, and a reward ledger with a holding period.

**Phase 3. Video (M-L, about 5-6 weeks in total with moderation).** Resumable upload, a separate media worker container, transcoding, frame and audio checks, offsite backup.

**Phase 4. Later.** Receipt scanning and location-dwell evidence for verification, and auto-posting to travellers' own accounts.

## 5. Moderation design (agent 3)

- **Pipeline:** save as pending, then (0) rule checks for phone numbers, emails, ID numbers and spam links; (1) OpenAI's free moderation model on text and images; (2) Claude (Haiku, escalating to Sonnet) applies a written policy and returns categories, quoted spans, a reason and **one specific question for the reviewer**. Post text is treated as untrusted (prompt-injection safe). Fail closed: if a service is down, the post stays pending.
- **Outcomes:** allow, hold for a person, or block, with thresholds calibrated on a test set. Always hold: personal information, accusations against named businesses or people, and distress or self-harm.
- **Author experience:** a blocked author sees the category, the quoted part and a plain reason; the draft is kept; an appeal goes to you, never back to the same model. Distress content gets supportive resources (Lifeline 13 11 14; check the Indonesian equivalent) and priority human review, never a penalty.
- **Review queue:** each item has the post, the flagged part, the agent's reason and one question with 2-3 answer buttons. You answer; Claude can give a second opinion in a session. Answers are stored as labelled cases; you promote good ones into policy notes and examples. Answers never rewrite the prompt automatically.
- **Reports and strikes:** user reports join the same queue (3 unique reporters hides a post pending review). Strikes only count after human confirmation.
- **Audit:** append-only log of every decision with the policy version.
- **Draft policy:** swearing about experiences or places is allowed ("shit hole", "fucking amazing", "anjing, macet parah"); swearing at people, slurs, hate, threats, doxxing, explicit sexual content and graphic gore are not. Warnings about scams and dangerous places must be allowed.
- **Cost (estimate, unverified):** about US$0.7 per 1,000 comments and US$3-4 per 1,000 blogs with Haiku. OpenAI moderation is free. Google's Perspective API is shutting down (31 Dec 2026), so do not use it.
- **Risks:** Indonesian slang accuracy is unproven, over-blocking of safety warnings, and text going to third-party AI providers (must be disclosed in the Privacy Policy).
- A 12-example test set is in the moderation agent's report; build a 30-item set and run it before every policy change.

## 6. Confirmed visits (agent 4)

- **Label:** use a distinct label such as "Visit confirmed" (or "Visit evidence checked" on the legal agent's advice), not the operator tick. Operator "Verified" means the business is real; this means Drift is confident this person was there. Same visual family, different words. "Booked via Drift" is the strongest sub-label. Show "N confirmed visits" on places.
- **Evidence and points:** Drift hotel booking (paid, confirmed, not sandbox, not cancelled) auto-confirms on its own; location dwell 40; receipt read by a vision model 45; text consistency up to 15; photo EXIF only 10 (trivially forged); account history up to 25; a reverse-image match is -60 and a flag.
- **Tiers:** auto-confirmed (booking, or 80+ points with two independent signals; 5% audited by a person), likely (40-79, goes to you with a question), unverified (publishes without a badge), rejected (only the badge and reward are denied; the post stays).
- **Sentiment and rating are never inputs.** A 1-star and a 5-star visit with the same evidence get the same verdict.
- **Sample questions:** "Receipt says Warung Bali Sari, place is Bali Sari Cafe 400 m away. Same business?", "Receipt is dated the day before check-in. Accept?", "Photo GPS is 6 km away but the time fits. Accept or reject?".
- **Anti-gaming:** reward paid only for a confirmed visit, equal regardless of rating; 14-day hold (30 for new accounts); caps per place and per month; operators and accounts sharing their device cannot confirm their own place; cancelled or sandbox bookings never count.
- **Privacy:** location dwell needs a separate consent, not Trip Mode's. Keep derived results only (raw pings expire at 7 days). Receipts are redacted, then deleted 30 days after the decision. Operators see counts, never identities.
- **Practical limit:** there is almost no data yet (1 post, 0 member places, 0 location rows), so start with rules, not a trained model.

## 7. Media and video (agent 2)

- **Server:** 4 CPU cores (no AVX), 15 GB RAM with swap already in use, 122 GB free disk shared with everything else, backups are a nightly database dump on the same disk only. Transcoding was measured at 0.66x real time on a fast preset, so a 60 s clip takes about 90 s of one core.
- **Architecture:** resumable uploads (tus, 8 MB chunks; also keeps under Cloudflare's roughly 100 MB request cap on the tunnel, *unverified*), file checks by content not name, a separate media-worker container limited to 2 CPUs and 2 GB, a dedicated Redis queue with concurrency 1, one H.264 MP4 rendition plus a poster frame, photos re-encoded with all metadata removed. Public files appear only after moderation approves them.
- **Location privacy:** read the original's date and GPS into a private, audited table, then strip it from the public copy and fail the job if any GPS remains. Keep originals 30 days in a folder the web server never serves.
- **Caps:** photo 20 MB, 20 per post; video 500 MB source, 60 s (120 s later), 3 per post; 5 videos a day; 2 GB per user; stop video uploads at 80% disk.
- **Growth:** fine on this server to about 100 active posters. Move public files to object storage (Cloudflare R2, about US$0.015/GB-month, no egress fee, *unverified*) at about 300 posters or when free disk falls below 50 GB. At 1,000 posters expect about 41 GB/month of new files and roughly US$12/month of R2 storage plus about US$40/month moderation.
- **Top risk:** filling the shared disk would take down the database and every other project on the server. Also add offsite backups (uploads currently have none).

## 8. Legal, consent, rewards, sharing (agent 5)

- **Consent:** separate, unticked, per post, never a condition of posting or of the reward. Non-exclusive licence limited to featuring that post on named Drift channels; the author keeps ownership and credit. Withdrawal stops future use and removes it from Drift's channels within 7 days; say up front that copies others made cannot be recalled. Store post id, scope, wording version and text hash, terms version, and a publications ledger so withdrawal can trigger takedowns. Authors confirm they own the content, identifiable people agreed, no identifiable children unless they are the guardian, and any music is licensed.
- **Rewards:** must not depend on rating or sentiment and must be disclosed ("Contributor reward"). Recommended first reward: **fixed points per approved post with a confirmed visit**, capped weekly. Travel credit later (stored-value and tax questions). No rewards for likes or shares. Contests are not for launch. Never hide negative posts about paying operators.
- **Fake-review law:** misleading-conduct law and ACCC guidance apply now (past penalties: HealthEngine A$2.9m). A new Unfair Trading Practices Act (assent 2 Jul 2026, starts 1 Jul 2027) is reported to raise penalties sharply *(unverified: the Act text was not read)*. In the US, the FTC rule (16 CFR 465) bans incentives tied to sentiment.
- **User-content duties:** eSafety expects a working report and complaints channel and clear terms; removal notices can carry 24-hour deadlines. If Drift counts as a "social media service" the 16+ minimum age applies, so set the minimum age at 16, and avoid follows and direct messages on the blog at launch. Under the defamation reforms a platform's defence needs an accessible complaints channel and action within 7 days, **but reposting on Drift's own channels makes Drift the publisher**, so featured posts naming businesses or people need review. Offer businesses a right of reply. Indonesia: assume no safe harbour; takedown rules are strict and defamation can be a criminal complaint.
- **Sharing:** Phase 1 share buttons: the Web Share API where available, plus links for Facebook, X, WhatsApp, LinkedIn and Pinterest. Instagram and TikTok have no web share link: offer a download (9:16 video, copy-caption) and the phone's share sheet.
- **Auto-post later:** Instagram needs Business or Creator accounts and Meta app review for publishing; TikTok unaudited apps can only post privately; YouTube uploads stay private until audited; X charges per post. Expect weeks of platform review for each.

## 9. Needs a lawyer

Licence and moral-rights wording and unfair-contract-terms review; the reward scheme (stored value, permits, tax); whether Drift is a "social media service" for eSafety; the defamation defence and the rule for reposting on Drift's channels; Privacy Act small-business status and overseas disclosure; Indonesian counsel on registration and defamation exposure.

## 10. Decisions needed from Andre

1. **Start Phase 0 (repair the base)?** Recommended now; nothing else can safely sit on it.
2. **Publish before checking?** Recommend hold everything until we have real data (there is 1 post today).
3. **Badge wording:** "Visit confirmed" (same look as the tick, different label), or your preferred wording.
4. **Reward:** fixed points per approved post with a confirmed visit, capped weekly, labelled "Contributor reward". OK as the first version?
5. **Video timing:** you chose to host it ourselves. Recommend it as Phase 3, after text and photos are moderated and live. Is 60 seconds and 500 MB acceptable, and is 4K needed?
6. **Budget:** moderation calls (tens of dollars a month at first) and, later, R2 storage.
7. **Minimum age 16 and no follows or direct messages on the blog at launch?**
8. **Engage a lawyer** (Australian, and Indonesian counsel for the Bali audience)?
9. **Who answers reviewer questions in Indonesian?**
