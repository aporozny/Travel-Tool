# Project Initiation Documentation (PID)
## Project: Drift Discovery Engine

| | |
|---|---|
| **Project name** | Drift Discovery Engine |
| **Date** | 2026-07-08 |
| **Version** | 1.0 |
| **Executive / Senior User** | Andre (product owner) |
| **Senior Supplier** | Claude (AI development) |
| **Method** | PRINCE2, tailored for solo-owner + AI-team delivery |

## 1. Project definition

### Background
Drift (drifttravel.app) is a travel platform for solo travellers: see where others have been, discover places, and invite others to join tours. The discovery pipeline (places to stay / eat / do) is the core of the product. A 2026-07-08 technical review found it hardcoded to Bali, single-sourced from Google's legacy API, using naive rating math, category-blind scoring, and ignoring the community signals that are Drift's differentiator.

### Objectives
1. Discovery works for **any destination worldwide** (remove Bali hardcode, real geocoding).
2. Fresh, multi-category results on every ask (coverage-threshold refresh).
3. Trustworthy ranking (Bayesian ratings, category-aware scoring, capped paid boosts).
4. Foundation for social proof and bookable tours (Viator) in later stages.
5. Every component documented well enough to recreate from scratch (see DR-RUNBOOK.md).

### Scope
**In scope:** backend discovery services (`googlePlaces.ts`, `searchCache.ts`, `recommendations.ts`, new `geocoding.ts`), scoring tests, PM documentation, DR runbook.
**Out of scope (this project):** mobile app changes, operator billing, Foursquare/Viator integration (future project), frontend redesign.

### Deliverables (Products)
See PRODUCT-DESCRIPTIONS.md. Summary:
- P1 Geocoding service (destination → lat/lng/country, Redis-cached)
- P2 Destination-agnostic Google Places source
- P3 Coverage-threshold catalog refresh
- P4 Category-aware Bayesian scorer
- P5 Scoring test suite
- P6 PM + DR documentation set

## 2. Business case (summary)
- **Cost:** AI development time; no new paid services in Stage 1 (reuses existing Google key).
- **Benefit:** app usable beyond Bali (market: every destination); ranking users can trust; future Viator commissions (6–30% per booking) enabled by Stage 3.
- **Do-nothing risk:** app cannot serve its stated purpose for any non-Bali destination; recommendations skewed by a mislabelled +20 verified bonus erode user trust.

## 3. Project management team & roles
| Role | Who | Responsibilities |
|---|---|---|
| Project Executive | Andre | Approves stage boundaries, owns business case |
| Senior User | Andre | Accepts products against quality criteria |
| Project/Delivery | Claude (AI) | Designs, implements, tests, documents |
| Assurance | Andre + test suite | Reviews diffs, runs UAT on drifttravel.app |

## 4. Stage plan structure
| Stage | Content | Status |
|---|---|---|
| Stage 1 | World-wide discovery + honest scoring + docs | Complete — see STAGE-PLAN-1.md |
| Stage 2 | Social-proof signals in ranking; interaction learning loop | Complete — see STAGE-PLAN-2.md |
| Stage 3 | Sub-areas / geographic drill-down | Complete — see STAGE-PLAN-3.md |
| Stage 4 | Coverage gating + test-suite fixes | Complete — see STAGE-PLAN-4.md |
| Stage 5 | Surface the discovery engine in the UI (Bali/Albania hardcode removal, public site fix) | Complete — see STAGE-PLAN-5.md |
| Stage 6 | Booking ecosystem Phase 1: activities via Viator | Code complete, live pending VIATOR_API_KEY — see STAGE-PLAN-6.md |
| Stage 7 | Drift Safety Line: inbound voice agent (LiveKit + Claude + ElevenLabs) | Live — see STAGE-PLAN-7.md |
| Stage 8 | Public launch readiness: security audit, password reset | Complete, two Executive actions open — see STAGE-PLAN-8.md |
| Stage 9 | Owner-curated Trips with RSVP | Complete — see STAGE-PLAN-9.md |
| Stage 10 | Booking ecosystem Phase 2: flights via Duffel (search live, checkout pending) | Search live, checkout blocked on Executive decision — see STAGE-PLAN-10.md |
| Stage 11 | Booking ecosystem Phase 3: stays/hotels via Duffel | Research complete, build not started — see STAGE-PLAN-11.md |

## 5. Project controls
- **Tolerances:** Stage 1 time ±1 session; scope: P1–P6 fixed, no gold-plating. Escalate to Executive if any product cannot be delivered.
- **Quality:** every code product typechecks (`npm run build`), scoring logic covered by Jest tests, live verification on production after deploy (health + non-Bali search).
- **Change control:** all changes via git commits on `main`, one product per commit where practical. Registers updated at stage end (RISK-REGISTER.md, ISSUE-REGISTER.md, LESSONS-LOG.md).
- **Reporting:** end-stage summary appended to STAGE-PLAN-1.md.

## 6. Communication
Single-channel: this repo's `docs/pm/` is the source of truth. Production status in DEPLOYMENT_STATUS.md (repo root, pre-existing).
