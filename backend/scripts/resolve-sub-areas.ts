import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../src/utils/db';

// Stage B: the only place sub_area_id is ever written. Runs on a schedule
// (cron, outside this process), never live/per-request. Resolves raw
// Google addressComponents tags captured at upsert time (Stage A, in
// searchCache.ts) into real sub_areas rows, then computes the per-category
// coverage snapshot that gates which sub-areas are ever offered to users.
//
// Phase 1: source is always 'google_tag'. DBSCAN clustering (for cities
// where Google's own tagging is sparse) and OSM boundary import are
// deferred — the schema already supports both, so adding them later needs
// no migration, just a new resolution path feeding the same sub_areas /
// sub_area_coverage tables.

const CATEGORIES = ['food', 'accommodation', 'activity', 'transport'];

// Per-category floor for the coverage snapshot (dashboard/future-gating
// value). The actual offer decision at the API layer uses a total-count
// floor across all categories, not this alone — see search.ts.
const CATEGORY_MIN_COVERAGE = 2;

// Trigram similarity floor for matching a new raw tag against an existing
// sub_area's canonical_slug. Catches formatting variance ("Tiong Bahru" vs
// "Tiong Bahru, Singapore") — not semantic variance ("CBD" vs "Downtown
// Core", or "Nakhon" vs "Khet Phra Nakhon"), which is a known, accepted
// residual gap. Not auto-resolved — surfaced via logProbableDuplicates
// below instead, for a human to merge.
const SIMILARITY_THRESHOLD = 0.6;

// Distance floor for the "probable duplicate" advisory check. Deliberately
// generous: sub-areas here range from tight neighborhoods to large city
// districts (Bangkok's Khet), so a tight radius (e.g. 200m) misses real
// duplicates at district scale — confirmed against real data where
// "Nakhon" / "Phranakorn" / "Khet Phra Nakhon" (clearly the same district)
// landed 300-600m apart by centroid.
const DUPLICATE_DISTANCE_METERS = 750;

function normalizeSlug(rawTag: string, region: string, country: string): string {
  let s = rawTag.toLowerCase().trim();
  // Strip a trailing ", {region}" or ", {country}" suffix Google sometimes
  // appends to the component text itself.
  const suffixes = [region, country].filter(Boolean).map((x) => x.toLowerCase());
  for (const suf of suffixes) {
    const pattern = new RegExp(`,?\\s*${suf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    s = s.replace(pattern, '');
  }
  return s
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface UnresolvedPlace {
  id: string;
  region: string;
  country: string;
  raw_subregion_tag: string;
  latitude: string | null;
  longitude: string | null;
}

async function resolveRegion(region: string): Promise<{ resolved: number; created: number }> {
  const { rows: unresolved } = await pool.query<UnresolvedPlace>(
    `SELECT id, region, country, raw_subregion_tag, latitude, longitude
     FROM places_cache
     WHERE region = $1
       AND raw_subregion_tag IS NOT NULL
       AND sub_area_id IS NULL
       AND expires_at > NOW()`,
    [region],
  );

  let resolved = 0;
  let created = 0;

  for (const place of unresolved) {
    const country = place.country || '';
    const slug = normalizeSlug(place.raw_subregion_tag, region, country);
    if (!slug) continue;

    // Best fuzzy match among this region's existing sub_areas.
    const { rows: matches } = await pool.query(
      `SELECT id, similarity(canonical_slug, $2) AS sim
       FROM sub_areas
       WHERE region = $1
       ORDER BY sim DESC
       LIMIT 1`,
      [region, slug],
    );

    let subAreaId: string;
    if (matches.length > 0 && matches[0].sim >= SIMILARITY_THRESHOLD) {
      subAreaId = matches[0].id;
    } else {
      const { rows: inserted } = await pool.query(
        `INSERT INTO sub_areas (region, canonical_name, canonical_slug, source, centroid_lat, centroid_lng)
         VALUES ($1, $2, $3, 'google_tag', $4, $5)
         ON CONFLICT (region, canonical_slug) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [region, place.raw_subregion_tag.trim(), slug, place.latitude, place.longitude],
      );
      subAreaId = inserted[0].id;
      created++;
    }

    await pool.query(`UPDATE places_cache SET sub_area_id = $1 WHERE id = $2`, [
      subAreaId,
      place.id,
    ]);
    resolved++;
  }

  // Recompute centroids for every sub_area in this region from their
  // currently-assigned places (cheap, region-scoped, keeps the centroid
  // honest as more places get assigned over time).
  await pool.query(
    `UPDATE sub_areas sa
     SET centroid_lat = c.avg_lat, centroid_lng = c.avg_lng, updated_at = NOW()
     FROM (
       SELECT sub_area_id, AVG(latitude) AS avg_lat, AVG(longitude) AS avg_lng
       FROM places_cache
       WHERE sub_area_id IS NOT NULL AND region = $1
       GROUP BY sub_area_id
     ) c
     WHERE sa.id = c.sub_area_id`,
    [region],
  );

  // Coverage snapshot: per sub_area, per category, in this region.
  const { rows: subAreas } = await pool.query(`SELECT id FROM sub_areas WHERE region = $1`, [
    region,
  ]);
  for (const sa of subAreas) {
    for (const category of CATEGORIES) {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) AS c FROM places_cache
         WHERE sub_area_id = $1 AND category = $2 AND expires_at > NOW()`,
        [sa.id, category],
      );
      const rowCount = parseInt(countRows[0].c, 10);
      await pool.query(
        `INSERT INTO sub_area_coverage (sub_area_id, category, row_count, meets_threshold, computed_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (sub_area_id, category) DO UPDATE SET
           row_count = EXCLUDED.row_count,
           meets_threshold = EXCLUDED.meets_threshold,
           computed_at = NOW()`,
        [sa.id, category, rowCount, rowCount >= CATEGORY_MIN_COVERAGE],
      );
    }
  }

  return { resolved, created };
}

// Advisory only — never auto-merges. Flags pairs of sub_areas in the same
// region whose centroids are close but whose names didn't trigram-match,
// so a human can review and merge if they really are the same place.
async function logProbableDuplicates(region: string): Promise<void> {
  const { rows: pairs } = await pool.query(
    `SELECT a.canonical_name AS name_a, b.canonical_name AS name_b,
            ST_DistanceSphere(
              ST_MakePoint(a.centroid_lng, a.centroid_lat),
              ST_MakePoint(b.centroid_lng, b.centroid_lat)
            ) AS meters
     FROM sub_areas a
     JOIN sub_areas b ON b.region = a.region AND b.id > a.id
     WHERE a.region = $1
       AND a.centroid_lat IS NOT NULL AND b.centroid_lat IS NOT NULL
       AND ST_DistanceSphere(
             ST_MakePoint(a.centroid_lng, a.centroid_lat),
             ST_MakePoint(b.centroid_lng, b.centroid_lat)
           ) < $2
     ORDER BY meters ASC`,
    [region, DUPLICATE_DISTANCE_METERS],
  );
  for (const p of pairs) {
    console.warn(
      `  [probable duplicate] "${p.name_a}" / "${p.name_b}" — ${Math.round(p.meters)}m apart, not auto-merged`,
    );
  }
}

async function main() {
  const { rows: regions } = await pool.query(
    `SELECT DISTINCT region FROM places_cache
     WHERE raw_subregion_tag IS NOT NULL AND sub_area_id IS NULL AND expires_at > NOW()
     UNION
     SELECT DISTINCT region FROM sub_areas`,
  );

  console.log(`Resolving sub-areas for ${regions.length} region(s)...`);
  let totalResolved = 0;
  let totalCreated = 0;
  for (const { region } of regions) {
    const { resolved, created } = await resolveRegion(region);
    if (resolved > 0 || created > 0) {
      console.log(`  ${region}: resolved ${resolved} place(s), created ${created} new sub-area(s)`);
    }
    totalResolved += resolved;
    totalCreated += created;
    await logProbableDuplicates(region);
  }
  console.log(`Done. ${totalResolved} places resolved, ${totalCreated} sub-areas created.`);
  await pool.end();
}

main().catch((err) => {
  console.error('resolve-sub-areas failed:', err);
  process.exit(1);
});
