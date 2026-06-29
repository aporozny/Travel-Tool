-- Migration 023: Add nationality and date_of_birth to travelers
--
-- These columns were defined in the original schema.sql but were never
-- actually applied to the live database. The live travelers table was
-- built up via the numbered migrations (001 onward), none of which ever
-- created these two columns, even though backend/src/routes/travelers.ts
-- and backend/src/routes/community.ts have always referenced them,
-- causing GET/PATCH /api/v1/travelers/me and three routes in community.ts
-- (feed, discover, posts/:id) to 500 with "column t.nationality does not
-- exist" or "column t.date_of_birth does not exist".
--
-- Confirmed via migration history: no prior migration ever created or
-- dropped either column (ruled out a deliberate removal, e.g. for
-- privacy reasons, before writing this).

ALTER TABLE travelers ADD COLUMN IF NOT EXISTS nationality VARCHAR(50);
ALTER TABLE travelers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
