import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../src/utils/db';
import { redis } from '../src/utils/redis';
import { reverseGeocodeNeighborhoodName } from '../src/services/neighborhoodLookup';

// Stage B: the only place sub_area_id is ever written. Runs on a schedule
// (cron, outside this process), never live/per-request. Resolves raw
// Google addressComponents tags captured at upsert time (Stage A, in
// searchCache.ts) into real sub_areas rows, then falls back to DBSCAN
// clustering for whatever's left untagged (Phase 2 — cities where Google's
// own sublocality tagging is sparse, e.g. Windhoek), then computes the
// per-category coverage snapshot that gates which sub-areas are ever
// offered to users.
//
// OSM boundary import (Phase 3, for precision/naming and as a third
// candidate source) is still deferred — the schema already supports it
// (source enum, nullable geometry column), so adding it later needs no
// migration, just a new resolution path feeding the same tables.

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

// DBSCAN fallback (Phase 2), for places Google never tagged with a
// sublocality/neighborhood at all. eps in meters (transformed to Web
// Mercator so distance is metric, not degrees) — walkable-district scale,
// per the agreed design range (350-500m). minpoints avoids a single
// restaurant becoming its own "neighborhood".
const DBSCAN_EPS_METERS = 400;
const DBSCAN_MIN_POINTS = 5;

// A cluster only gets named from real, recognizable text — never a
// generic "Cluster 4". Address-token harvest needs real plurality
// agreement among members, not just whichever address happened to be
// scanned first, or a single stray street name would name the whole area.
const TOKEN_HARVEST_MIN_SHARE = 0.3;

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

interface ClusterCandidate {
  id: string;
  address: string | null;
  name: string;
  review_count: number | string | null;
  latitude: string | null;
  longitude: string | null;
  cluster_id: number | null;
}

// Never a generic "Cluster N" — only a real, recognizable name. Three
// tiers, reverse-geocode FIRST: (1) reverse-geocode the cluster centroid
// (Google Geocoding first — same account already paid for, verified live
// against Singapore data returning "Bishan" — then OpenStreetMap/
// Nominatim as an independent second source); structurally typed as a
// real neighborhood, so it's tried before the heuristic tiers below.
// (2) address-token harvest (most frequent comma-separated segment across
// members' addresses) as a fallback when reverse-geocoding fails —
// token-harvest cannot tell a street address from a neighborhood name
// (a cluster near "22 Sin Ming Ln" harvested that street segment as its
// "name" before this reorder, even though reverse-geocoding the same
// centroid correctly returns "Bishan"), so it must not run first.
// (3) name after the cluster's highest-review-count place ("near X") as
// the absolute last resort — still a real business name, never invented.
async function harvestClusterName(
  members: ClusterCandidate[],
  region: string,
  centroidLat: number,
  centroidLng: number,
): Promise<string | null> {
  const reverseGeocoded = await reverseGeocodeNeighborhoodName(centroidLat, centroidLng);
  if (reverseGeocoded) return reverseGeocoded;

  const tokenCounts = new Map<string, number>();
  for (const m of members) {
    if (!m.address) continue;
    const segments = m.address
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const candidates = segments
      .slice(0, -2)
      .filter((s) => s.toLowerCase() !== region.toLowerCase());
    for (const c of candidates) {
      tokenCounts.set(c, (tokenCounts.get(c) || 0) + 1);
    }
  }
  if (tokenCounts.size > 0) {
    const [topToken, count] = [...tokenCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (count >= Math.max(2, Math.ceil(members.length * TOKEN_HARVEST_MIN_SHARE))) {
      return topToken;
    }
  }

  const byReviews = [...members].sort(
    (a, b) => (parseInt(b.review_count as string, 10) || 0) - (parseInt(a.review_count as string, 10) || 0),
  );
  return byReviews[0] ? `near ${byReviews[0].name}` : null;
}

async function runDBSCANFallback(region: string): Promise<{ resolved: number; created: number }> {
  const { rows } = await pool.query<ClusterCandidate>(
    `SELECT id, address, name, review_count, latitude, longitude,
            ST_ClusterDBSCAN(
              ST_Transform(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326), 3857),
              eps := $2, minpoints := $3
            ) OVER () AS cluster_id
     FROM places_cache
     WHERE region = $1
       AND sub_area_id IS NULL
       AND raw_subregion_tag IS NULL
       AND expires_at > NOW()
       AND latitude IS NOT NULL AND longitude IS NOT NULL`,
    [region, DBSCAN_EPS_METERS, DBSCAN_MIN_POINTS],
  );

  const clusters = new Map<number, ClusterCandidate[]>();
  for (const row of rows) {
    if (row.cluster_id === null) continue; // DBSCAN noise point, not a real cluster
    if (!clusters.has(row.cluster_id)) clusters.set(row.cluster_id, []);
    clusters.get(row.cluster_id)!.push(row);
  }

  let resolved = 0;
  let created = 0;

  for (const members of clusters.values()) {
    const centroidLat =
      members.reduce((sum, m) => sum + parseFloat(m.latitude || "0"), 0) / members.length;
    const centroidLng =
      members.reduce((sum, m) => sum + parseFloat(m.longitude || "0"), 0) / members.length;
    const name = await harvestClusterName(members, region, centroidLat, centroidLng);
    if (!name) continue;
    const slug = normalizeSlug(name, region, '');
    if (!slug) continue;

    // Same fuzzy-match-or-create pattern as the tag path — if this cluster
    // lands on a name close to an already-existing sub_area (created from a
    // Google tag on a different place), merge into it instead of
    // duplicating the same real-world area under a second source.
    const { rows: matches } = await pool.query(
      `SELECT id, similarity(canonical_slug, $2) AS sim
       FROM sub_areas WHERE region = $1 ORDER BY sim DESC LIMIT 1`,
      [region, slug],
    );

    let subAreaId: string;
    if (matches.length > 0 && matches[0].sim >= SIMILARITY_THRESHOLD) {
      subAreaId = matches[0].id;
    } else {
      const { rows: inserted } = await pool.query(
        `INSERT INTO sub_areas (region, canonical_name, canonical_slug, source)
         VALUES ($1, $2, $3, 'cluster')
         ON CONFLICT (region, canonical_slug) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [region, name, slug],
      );
      subAreaId = inserted[0].id;
      created++;
    }

    for (const m of members) {
      await pool.query(`UPDATE places_cache SET sub_area_id = $1 WHERE id = $2`, [
        subAreaId,
        m.id,
      ]);
      resolved++;
    }
  }

  return { resolved, created };
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

  // Phase 2: DBSCAN whatever's left with no tag to resolve from at all —
  // runs after tag resolution so it only sees places tag-matching couldn't
  // already claim.
  const dbscanResult = await runDBSCANFallback(region);
  resolved += dbscanResult.resolved;
  created += dbscanResult.created;

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
     WHERE sub_area_id IS NULL AND expires_at > NOW()
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
  // ioredis keeps a persistent auto-reconnecting connection open — without
  // this the process never exits after finishing (found accumulating
  // hung hourly-cron processes on the VPS: every run since this script
  // started importing redis logged "Done" but never terminated).
  redis.disconnect();
}

main().catch((err) => {
  console.error('resolve-sub-areas failed:', err);
  process.exit(1);
});
