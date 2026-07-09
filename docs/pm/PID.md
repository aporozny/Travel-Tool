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
| Stage 1 | P1–P6: world-wide discovery + honest scoring + docs | **Current** — see STAGE-PLAN-1.md |
| Stage 2 | Social-proof signals in ranking; interaction learning loop | Planned |
| Stage 3 | Viator bookable tours; Foursquare second source + dedup | Planned |

## 5. Project controls
- **Tolerances:** Stage 1 time ±1 session; scope: P1–P6 fixed, no gold-plating. Escalate to Executive if any product cannot be delivered.
- **Quality:** every code product typechecks (`npm run build`), scoring logic covered by Jest tests, live verification on production after deploy (health + non-Bali search).
- **Change control:** all changes via git commits on `main`, one product per commit where practical. Registers updated at stage end (RISK-REGISTER.md, ISSUE-REGISTER.md, LESSONS-LOG.md).
- **Reporting:** end-stage summary appended to STAGE-PLAN-1.md.

## 6. Communication
Single-channel: this repo's `docs/pm/` is the source of truth. Production status in DEPLOYMENT_STATUS.md (repo root, pre-existing).
