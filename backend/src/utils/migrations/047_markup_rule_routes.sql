-- Migration 047: let a route carry its own markup rule instead of only the single global one.
-- markup_rules already had a `scope` column ('global' | 'route' | 'cabin_class') and
-- route_origin/route_destination columns, but nothing ever set or read a 'route' row (see
-- flights.ts's old comment: "scoped rules exist in the schema but aren't selected here yet").
-- This adds the integrity rules a route row needs and enforces there is ever only one ACTIVE
-- rule for a given key, so a search can never find two conflicting active rules.

-- A route rule must carry a valid-looking IATA pair; a global rule must carry neither.
-- IS NOT NULL guards matter here, not just style: a bare `route_origin ~ '...'` against a NULL
-- value evaluates to NULL rather than false, and a CHECK constraint only rejects an explicit
-- false -- a NULL result passes silently. Caught by testing this against a scratch database
-- before it went anywhere near production (a 'route' row with no origin/destination got inserted
-- without the guards).
ALTER TABLE markup_rules DROP CONSTRAINT IF EXISTS markup_rules_route_fields_check;
ALTER TABLE markup_rules ADD CONSTRAINT markup_rules_route_fields_check
  CHECK (
    (scope = 'route' AND route_origin IS NOT NULL AND route_destination IS NOT NULL
       AND route_origin ~ '^[A-Z]{3}$' AND route_destination ~ '^[A-Z]{3}$')
    OR (scope <> 'route' AND route_origin IS NULL AND route_destination IS NULL)
  );

-- At most one active global rule ever (the app assumed this from the start but nothing enforced
-- it -- a second one could previously have been inserted and picked up ambiguously by LIMIT 1).
CREATE UNIQUE INDEX IF NOT EXISTS uq_markup_rules_one_active_global
  ON markup_rules (scope) WHERE scope = 'global' AND active = true;

-- At most one active rule per route.
CREATE UNIQUE INDEX IF NOT EXISTS uq_markup_rules_one_active_per_route
  ON markup_rules (route_origin, route_destination) WHERE scope = 'route' AND active = true;

SELECT 'Migration 047 complete -- route-scoped markup rules ready' AS status;
