import { pool } from '../utils/db';
import { searchPlaces, getPlaceDetails, PlaceResult } from './googlePlaces';

const CACHE_TTL_DAYS = 30;
const STALE_HOURS = 24; // re-fetch details after this many hours

// Check if a query has fresh cached results
async function getCachedResults(query: string, region: string, category?: string) {
  const result = await pool.query(
    `SELECT sq.last_searched_at,
            sq.result_count,
            NOW() - sq.last_searched_at < INTERVAL '${STALE_HOURS} hours' AS is_fresh
     FROM search_queries sq
     WHERE sq.query = $1 AND sq.region = $2 AND sq.category IS NOT DISTINCT FROM $3`,
    [query.toLowerCase(), region.toLowerCase(), category || null]
  );
  return result.rows[0] || null;
}

// Store a place result in the cache
async function upsertPlace(place: PlaceResult): Promise<string> {
  const result = await pool.query(
    `INSERT INTO places_cache (
       external_id, source, name, category, description, address, region, country,
       latitude, longitude, phone, website, rating, review_count, price_level,
       photos, opening_hours, tags, raw_data, last_fetched_at, expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW() + INTERVAL '${CACHE_TTL_DAYS} days')
     ON CONFLICT (external_id, source) DO UPDATE SET
       name = EXCLUDED.name,
       rating = EXCLUDED.rating,
       review_count = EXCLUDED.review_count,
       photos = EXCLUDED.photos,
       opening_hours = EXCLUDED.opening_hours,
       last_fetched_at = NOW(),
       expires_at = NOW() + INTERVAL '${CACHE_TTL_DAYS} days'
     RETURNING id`,
    [
      place.external_id, place.source, place.name, place.category,
      place.description, place.address, place.region, place.country,
      place.latitude, place.longitude, place.phone, place.website,
      place.rating, place.review_count, place.price_level,
      JSON.stringify(place.photos), place.opening_hours ? JSON.stringify(place.opening_hours) : null,
      place.tags, JSON.stringify(place.raw_data),
    ]
  );
  return result.rows[0].id;
}

// Record that a query was searched
async function recordQuery(query: string, region: string, category: string | undefined, count: number) {
  await pool.query(
    `INSERT INTO search_queries (query, region, category, result_count, last_searched_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (query, region, category) DO UPDATE SET
       result_count = EXCLUDED.result_count,
       last_searched_at = NOW()`,
    [query.toLowerCase(), region.toLowerCase(), category || null, count]
  );
}

// Get cached places for a query
async function getPlacesFromCache(query: string, region: string, category?: string, limit = 20) {
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
    [
      `%${region}%`,
      category || null,
      limit,
    ]
  );
  return result.rows;
}

// Main search function - cache-first, fetch from Google on miss
export async function search(
  query: string,
  region: string,
  category?: string,
  limit = 20
): Promise<{ results: any[]; source: 'cache' | 'google'; total: number }> {

  const cached = await getCachedResults(query, region, category);

  if (cached?.is_fresh) {
    const results = await getPlacesFromCache(query, region, category, limit);
    return { results, source: 'cache', total: cached.result_count };
  }

  // Cache miss or stale - fetch from Google
  try {
    const places = await searchPlaces(query, region);

    // Filter by category if specified
    const filtered = category
      ? places.filter(p => p.category === category)
      : places;

    // Store all results in cache
    await Promise.all(filtered.map(p => upsertPlace(p)));
    await recordQuery(query, region, category, filtered.length);

    // Return from cache (now populated)
    const results = await getPlacesFromCache(query, region, category, limit);
    return { results, source: 'google', total: filtered.length };

  } catch (err) {
    console.error('Google Places fetch failed, falling back to cache:', err);

    // Fallback to stale cache if Google fails
    const results = await getPlacesFromCache(query, region, category, limit);
    return { results, source: 'cache', total: results.length };
  }
}

// Get a single cached place by our DB id
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

// Enrich a cached place with full Google details (phone, website, description)
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
      [
        details.phone, details.website, details.description,
        details.opening_hours ? JSON.stringify(details.opening_hours) : null,
        details.region, id,
      ]
    );
  } catch (err) {
    console.error('Failed to enrich place:', err);
  }
}
