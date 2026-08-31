# Marketing Distribution — Setup & Status

Owner: Andre. Started 2026-08-29. Tracks the "Nobody Paid For This" campaign from creative-finalization through organic + paid distribution.

## Creative assets

Campaign strategy doc: https://claude.ai/code/artifact/f5151fba-c45e-44fa-9b10-0f83ac91e63f ("Nobody Paid For This")
General mockup set: https://claude.ai/code/artifact/3d7f29e3-7e6a-45c6-af2a-7963d91723e4
Bali/AU landing page: https://claude.ai/code/artifact/29e3541b-2384-4dfa-8744-60c5a63d13dd ("Backup for Bali")
Bali/AU mockup set: https://claude.ai/code/artifact/59a67d0d-9899-41a6-9707-43658fb77955

### Keep/redo decision — FINAL (2026-08-29)

**Ship as-is** (typographic/graphic pieces, no photography needed — export as PNG, minor copy/number pass only):
- [ ] Receipt ledger carousel (`Main.dc.html` in the general mockup set)
- [ ] "What We Don't Do" post (`WhatWeDontDo.dc.html`)
- [ ] Safety Line honesty-receipt carousel (Bali/AU set)
- [ ] Parent-audience FB post (Bali/AU set)
- [ ] Bali/AU Reels cover — 1.63M-Australians-visited-Bali stat (Bali/AU set)

**Needs real photo/video or an illustrator pass before publish-ready:**
- [ ] General Reel cover — route-pin illustration (`ReelCover.dc.html`)
- [ ] Pinterest pin — implies Lisbon content (`PinterestPin.dc.html`)
- [ ] TikTok split-screen comparison (`TikTokSplitScreen.dc.html`)

**Export blocker**: the artifact canvases are login-gated claude.ai pages — export the 5 keeper artboards to PNG/PDF via the canvas's own Save/export button in a logged-in browser session. This can't be done headlessly.

## Distribution decisions

- **Scheduler: Buffer** (chosen over Later, 2026-08-29). Covers IG/FB/TikTok/Pinterest/X.
- **Organic hub: Meta Business Suite** for IG + FB + Reels.
- **Paid**: Meta Ads Manager + TikTok Ads Manager, geo-targeted at the Bali/AU push specifically.

## Blockers to clear before any paid spend

- [ ] **Bali/AU landing page has no real hosted URL.** It only exists as a login-gated claude.ai artifact. Needs to live on `drifttravel.app` (or a subdomain) before Ads Manager can use it as a destination.
- [ ] **No Privacy Policy/ToS exists** (RISK-REGISTER R14). Both Meta and TikTok ad review require a privacy policy link, and Trip Mode collects live location — non-negotiable before paid runs.
- [ ] **Seller-of-Travel legal review (R9) still outstanding**, and live bookings are already running. Flag to whoever owns legal before scaling paid spend that drives more of the same traffic.

## Setup checklist

### 1. Buffer
- [ ] Sign up (business email); likely need paid tier for 5 channels (IG/FB/TikTok/Pinterest/X — free tier caps at 3).
- [ ] Connect IG (must be Business/Creator, linked to the FB Page — do Meta Business Suite step first if not converted).
- [ ] Connect FB Page, TikTok, Pinterest, X.
- [ ] Upload the 5 keeper assets once exported; schedule against the campaign doc's launch calendar.

### 2. Meta Business Suite
- [ ] Create/confirm Drift's Facebook Page.
- [ ] Create/convert Instagram to Business, link to the Page.
- [ ] Create Meta Business Manager account; add Page + IG as owned assets.
- [ ] Start business verification early — often the slowest step, can cap paid spend if not done.
- [ ] Add admins under Business Settings > People.

### 3. Meta Ads Manager (Bali/AU paid)
- [ ] Create ad account inside Business Manager; add payment method.
- [ ] Install Meta Pixel / Conversions API on drifttravel.app and the Bali/AU landing page (once hosted) — before spend starts, not after.
- [ ] Campaign structure:
  - Objective: Traffic (or Conversions once pixel has signal)
  - Geo: Australia (national to start; narrow to Sydney/Melbourne/Brisbane/Perth if budget-constrained)
  - Ad set A: parents/general travelers 28–55, interest in Bali/Indonesia travel + travel safety
  - Ad set B: independent travelers 18–30, interest in Bali/backpacking/gap year
  - Placements: IG Feed/Stories/Reels + FB Feed
  - Creative: honesty-receipt carousel, parent FB post, Bali Reels cover
  - Budget: ~$20–30/day test phase before scaling (verify current platform minimums at setup)

### 4. TikTok Ads Manager (Bali/AU paid)
- [ ] Sign up at ads.tiktok.com (separate login from Meta), add payment method.
- [ ] Install TikTok Pixel on the landing page.
- [ ] Campaign structure:
  - Objective: Traffic or Conversions
  - Geo: Australia
  - Audience: skews younger — 18–30 independent-traveler segment, interests in travel/Indonesia/Bali/backpacking
  - Creative gap: this channel is realistically blocked on the TikTok split-screen asset (native video performs far better than stills on TikTok) — consider delaying TikTok paid until that's produced
  - Budget: verify current minimums at setup, they shift periodically

## Sequencing

Organic (Buffer + Meta Business Suite) can go live once the 5 keeper assets are exported. Paid on both platforms should wait for the landing page to be hosted and the Privacy Policy to exist.
