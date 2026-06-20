# Admin System — Audit & Remediation Plan

**Date:** June 20, 2026
**Status:** Findings confirmed via code review. Remediation not yet started.

## Why this exists

Andre's Gmail account was promoted to admin and an Admin nav button was added
to the web app (commit fe32691). While reviewing the codebase to scope what
admin functionality should exist next, several gaps and one real bug were
found in what's already built. This doc records those findings and the plan
to fix them, so the work survives across sessions instead of living only in
chat history.

## Findings (confirmed in code, June 20 2026)

| Area | State | Evidence |
|---|---|---|
| Waitlist admin | Fully built — backend + `admin.html` UI | Working end-to-end |
| Listing claims | Backend exists, but **two separate, divergent implementations** of "admin approve/reject claim" | `PATCH /api/v1/operators/claims/:id` (operators.ts) AND `PATCH /api/v1/search/claims/:id` (search.ts) — both write to `listing_claims`, neither references the other. No frontend calls either one yet. |
| Safety reports | Critical reports fire `safetyEmitter.emit('report:critical', ...)` — **no listener exists anywhere.** Emitted into the void. | Grepped every `safetyEmitter` usage in backend/src — zero `.on('report:critical', ...)` handlers |
| SOS events | Real-time SSE channel exists, scoped per-SOS-id for the affected person/contacts — **no admin-facing list of open SOS events** | safety.ts lines ~440-506 |
| Admin auth | Re-implemented 4 separate times, inconsistently | Standalone middleware in waitlist.ts; inline `role !== 'admin'` checks in operators.ts (x2) and search.ts |
| Audit trail | No general mechanism. Claims have `reviewed_by`/`reviewed_at` (decent), but no `admin_actions` table or equivalent exists anywhere | Confirmed via schema grep |
| Housekeeping | Stale `safety.ts.backup` checked into git alongside the real `safety.ts` | Found during grep, not yet removed |

## Remediation plan

Phased, smallest/lowest-risk first. Each phase follows Architect -> Planner ->
Builder -> QA -> Reviewer -> Shipper. The Reviewer step is mandatory before
any phase ships — it's what should have caught the claims-endpoint
duplication before it shipped the first time.

### Phase 0 — Housekeeping
Remove `safety.ts.backup` after confirming nothing imports it.

### Phase 1 — Extract shared `requireAdmin` middleware
Replace all 4 duplicate admin-checks with one shared middleware
(`backend/src/middleware/requireAdmin.ts`). Migrate waitlist.ts, operators.ts
(x2 call sites), search.ts. Reviewer must confirm behavior is unchanged at
all 4 original call sites before shipping — highest risk step since it
touches existing working auth.

### Phase 2 — Resolve duplicate claims endpoints
Pick canonical implementation (operators.ts is more complete — has the
`/queue` listing endpoint too). Check mobile app for any dependency on the
losing endpoint before deleting it. Consolidate, test approve+reject
end-to-end, ship.

### Phase 3 — Wire `report:critical` to something real
Minimum viable: write critical reports to a queryable table first, UI
second. Reviewer confirms severity threshold (>=4) matches what safety.ts
actually emits.

### Phase 4 — SOS admin dashboard
Net-new. List open `sos_events`, last known location on demand, resolve
action, audit log of who viewed what.

### Phase 5 — `admin_actions` audit log table
Net-new. General-purpose audit trail for sensitive admin actions (viewing
location history, escalating SOS, changing user roles), not just claims.

## Status tracking

- [x] Phase -1: Admin role + nav button (commit fe32691)
- [ ] Phase 0: Remove safety.ts.backup
- [ ] Phase 1: Shared requireAdmin middleware
- [ ] Phase 2: Resolve duplicate claims endpoints
- [ ] Phase 3: Wire report:critical listener
- [ ] Phase 4: SOS admin dashboard
- [ ] Phase 5: admin_actions audit log
