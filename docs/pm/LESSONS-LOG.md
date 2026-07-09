# Lessons Log — Drift Discovery Engine

| ID | Date | Lesson | Apply how |
|---|---|---|---|
| L1 | 2026-07-08 | Hardcoded geography ("Bali Indonesia") silently capped the product's addressable market for months. | Never hardcode geo/market assumptions; resolve at runtime, fail loudly. |
| L2 | 2026-07-08 | A "cache-first, fetch-on-empty" pattern rots: partial data blocks refresh forever. | Cache decisions need a coverage/freshness threshold, not existence checks. |
| L3 | 2026-07-08 | Score weights drifted from their comments (+5 documented, +20 implemented) with no test to catch it. | Ranking logic must be unit-tested with ordering invariants. |
| L4 | 2026-07-08 | Interaction tracking was built but never wired into ranking — effort spent, value unrealised. | Close the loop in the same stage or explicitly defer with a ticket. |
| L5 | 2026-07-08 | Infra knowledge (tunnel, nginx, containers, backups) lived only in shell state until the DR runbook was written. | Every externally-visible service gets a runbook entry at creation time. |
