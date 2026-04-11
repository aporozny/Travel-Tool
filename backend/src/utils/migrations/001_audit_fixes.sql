-- Migration 001: Audit fixes

ALTER TABLE reviews ALTER COLUMN is_published SET DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_bookings_traveler_status ON bookings(traveler_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_operator_status ON bookings(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_start_date ON bookings(start_date);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);

ALTER TABLE search_queries DROP CONSTRAINT IF EXISTS search_queries_query_region_category_key;
DROP INDEX IF EXISTS search_queries_query_region_category_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_search_queries_unique
  ON search_queries(query, region, COALESCE(category, ''));

UPDATE places_cache SET raw_data = '{}'::jsonb WHERE raw_data IS NOT NULL AND raw_data != '{}'::jsonb;
