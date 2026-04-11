import { pool } from '../utils/db';
import { searchPlaces, getPlaceDetails, PlaceResult } from './googlePlaces';

const CACHE_TTL_DAYS = 30;
const STALE_DAYS = 7; // re-fetch from Google after 7 days, not 24 hours

async function getCachedResults(query: string, region: string, category?: string) {
  const result = await pool.query(
    `SELECT last_searched_at, result_count,
            NOW() - last_searched_at < INTERVAL '${STALE_DAYS} days' AS is_fresh
     FROM search_queries
     WHERE query = $1 AND region = $2
       AND (($3::text IS NULL AND category IS NULL) OR category = $3)`,
    [query.toLowerCase(), region.toLowerCase(), category || null]
  );
  return result.rows[0] || null;
}

// Bulk upsert - single round trip for all places
async function upsertPlaces(places: PlaceResult[]): Promise<void> {
  if (places.length === 0) return;

  const values = places.map(p => [
    p.external_id, p.source, p.name, p.category,
    p.description, p.address, p.region, p.country,
    p.latitude, p.longitude, p.phone, p.website,
    p.rating, p.review_count, p.price_level,
    JSON.stringify(p.photos), // photo references, not full URLs
    p.opening_hours ? JSON.stringify(p.opening_hours) : null,
    p.tags,
    JSON.stringify(p.raw_data),
  ]);

  // Build parameterised bulk insert
  const rowPlaceholders = values.map((_, i) => {
    const base = i * 19;
    const params = Array.from({ length: 19 }, (_, j) => `$${base + j + 1}`).join(', ');
    return `(${params}, NOW(), NOW() + INTERVAL '${CACHE_TTL_DAYS} days')`;
  }).join(', ');

  const flatValues = values.flat();

  await pool.query(
    `INSERT INTO places_cache (
       external_id, source, name, category, description, address, region, country,
       latitude, longitude, phone, website, rating, review_count, price_level,
       photos, opening_hours, tags, raw_data, last_fetched_at, expires_at
     ) VALUES ${rowPlaceholders}
     ON CONFLICT (external_id, source) DO UPDATE SET
       name = EXCLUDED.name,
       rating = EXCLUDED.rating,
       review_count = EXCLUDED.review_count,
       photos = EXCLUDED.photos,
       last_fetched_at = NOW(),
       expires_at = NOW() + INTERVAL '${CACHE_TTL_DAYS} days'`,
    flatValues
  );
}

async function recordQuery(query: string, region: string, category: string | undefined, count: number) {
  // Use COALESCE trick to handle NULL category in unique constraint
  await pool.query(
    `INSERT INTO search_queries (query, region, category, result_count, last_searched_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (query, region, category) DO UPDATE SET
       result_count = EXCLUDED.result_count,
       last_searched_at = NOW()`,
    [query.toLowerCase(), region.toLowerCase(), category || null, count]
  );
}

async function getPlacesFromCache(region: string, category?: string, limit = 20) {
  const result = await pool.query(
    `SELECT
       pc.id, pc.external_id, pc.source, pc.name, pc.category,
       pc.description, pc.address, pc.region, pc.latitude, pc.longitude,
       pc.phone, pc.website, pc.rating, pc.review_count, pc.price_level,
       pc.photos, pc.tags, pc.is_claimed, pc.operator_id, pc.last_fetched_at,
       o.business_name AS claimed_business_name,
       o.tier AS operator_tier
     FROM places_cache pc
     LEFT JOIN operators o ON o.id = pc.operator_id
     WHERE pc.expires_at > NOW()
       AND pc.region ILIKE $1
       AND ($2::text IS NULL OR pc.category = $2)
     ORDER BY pc.is_claimed DESC, pc.rating DESC NULLS LAST
     LIMIT $3`,
    [`%${region}%`, category || null, limit]
  );
  return result.rows;
}

export async function search(
  query: string,
  region: string,
  category?: string,
  limit = 20
): Promise<{ results: any[]; source: 'cache' | 'google'; total: number }> {

  const cached = await getCachedResults(query, region, category);

  if (cached?.is_fresh) {
    const results = await getPlacesFromCache(region, category, limit);
    return { results, source: 'cache', total: cached.result_count };
  }

  try {
    const places = await searchPlaces(query, region);
    const filtered = category ? places.filter(p => p.category === category) : places;

    // Single bulk INSERT instead of N individual inserts
    await upsertPlaces(filtered);
    await recordQuery(query, region, category, filtered.length);

    const results = await getPlacesFromCache(region, category, limit);
    return { results, source: 'google', total: filtered.length };

  } catch (err) {
    console.error('Google Places fetch failed, falling back to cache:', err);
    const results = await getPlacesFromCache(region, category, limit);
    return { results, source: 'cache', total: results.length };
  }
}

export async function getPlaceById(id: string) {
  const result = await pool.query(
    `SELECT pc.*, o.business_name AS claimed_business_name, o.tier AS operator_tier
     FROM places_cache pc
     LEFT JOIN operators o ON o.id = pc.operator_id
     WHERE pc.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function enrichPlace(id: string, externalId: string): Promise<void> {
  try {
    const details = await getPlaceDetails(externalId);
    await pool.query(
      `UPDATE places_cache SET
         phone = COALESCE($1, phone),
         website = COALESCE($2, website),
         description = COALESCE($3, description),
         opening_hours = COALESCE($4::jsonb, opening_hours),
         region = COALESCE($5, region),
         last_fetched_at = NOW()
       WHERE id = $6`,
      [details.phone, details.website, details.description,
       details.opening_hours ? JSON.stringify(details.opening_hours) : null,
       details.region, id]
    );
  } catch (err) {
    console.error('Failed to enrich place:', err);
  }
}
