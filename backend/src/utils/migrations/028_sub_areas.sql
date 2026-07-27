-- Migration 028: Sub-areas (neighborhoods/suburbs) for browsing a big city.
-- Phase 1 only: sub-areas sourced from Google Places addressComponents
-- (sublocality/neighborhood tags), captured for free from calls already
-- being made. DBSCAN clustering (for cities where Google's tagging is
-- sparse) and OSM boundary import are deferred to later phases — this
-- migration's schema already supports both (source enum, nullable
-- geometry column) so no future migration is needed to add them.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS sub_areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  region TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  canonical_slug TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('google_tag', 'cluster', 'osm_boundary')),
  centroid_lat NUMERIC(10,7),
  centroid_lng NUMERIC(10,7),
  geometry geometry(MultiPolygon, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_areas_region_slug ON sub_areas (region, canonical_slug);
CREATE INDEX IF NOT EXISTS idx_sub_areas_slug_trgm ON sub_areas USING GIN (canonical_slug gin_trgm_ops);

-- Per-category coverage snapshot, computed by the batch resolution job.
-- A sub-area is only ever offered to users based on THIS table, never
-- checked live/lazily at request time.
CREATE TABLE IF NOT EXISTS sub_area_coverage (
  sub_area_id UUID NOT NULL REFERENCES sub_areas(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  meets_threshold BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sub_area_id, category)
);

-- raw_subregion_tag: captured live, per-upsert, straight from Google's
-- addressComponents — non-authoritative, never shown to users directly.
-- sub_area_id: the only field that's ever shown to users; written only
-- by the batch resolution job, never live.
ALTER TABLE places_cache ADD COLUMN IF NOT EXISTS raw_subregion_tag TEXT;
ALTER TABLE places_cache ADD COLUMN IF NOT EXISTS sub_area_id UUID REFERENCES sub_areas(id);

CREATE INDEX IF NOT EXISTS idx_places_cache_sub_area ON places_cache (sub_area_id);
CREATE INDEX IF NOT EXISTS idx_places_cache_unresolved_tag
  ON places_cache (region)
  WHERE raw_subregion_tag IS NOT NULL AND sub_area_id IS NULL;

SELECT 'Migration 028 complete — sub_areas ready (Phase 1: google_tag source only)' AS status;
