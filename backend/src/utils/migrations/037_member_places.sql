-- Migration 037: member-sourced places. Today places_cache is 100% external
-- (Google/Foursquare/Viator) -- this lets a traveler's own trip post add a
-- real place the catalog doesn't have yet, source = 'member'. No new check
-- constraint on source (it's already a free-text column); 'member' becomes
-- a valid value by convention, same as every other source string here.

ALTER TABLE places_cache ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id);

-- Lets the existing community-reporting system (safety_reports already has
-- categories like 'scam', 'inappropriate_content') target a place, not just
-- a traveler/operator -- the abuse backstop for member places being visible
-- immediately rather than gated behind review.
ALTER TABLE safety_reports ADD COLUMN IF NOT EXISTS reported_place_cache_id UUID REFERENCES places_cache(id);

SELECT 'Migration 037 complete — places_cache.submitted_by + safety_reports.reported_place_cache_id' AS status;
