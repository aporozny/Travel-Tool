import { pool } from '../utils/db';
import { searchPlaces, getPlaceDetails, PlaceResult } from './googlePlaces';

const CACHE_TTL_DAYS = 30;

// Country-level terms map to a country filter; anything else is treated as an area/region.
const COUNTRY_TERMS: Record<string, string> = {
  bali: 'Indonesia',
  indonesia: 'Indonesia',
  albania: 'Albania',
};

function resolveGeo(term: string): { country?: string; region?: string } {
  const key = (term || '').toLowerCase().trim();
  if (COUNTRY_TERMS[key]) return { country: COUNTRY_TERMS[key] };
  if (!term) return {};
  return { region: term };
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
       photos, opening_hours, tags, raw_data, updated_at, expires_at
     ) VALUES ${rowPlaceholders}
     ON CONFLICT (external_id, source) DO UPDATE SET
       name = EXCLUDED.name,
       rating = EXCLUDED.rating,
       review_count = EXCLUDED.review_count,
       photos = EXCLUDED.photos,
       updated_at = NOW(),
       expires_at = NOW() + INTERVAL '${CACHE_TTL_DAYS} days'`,
    flatValues
  );
}

async function recordQuery(query: string, region: string, category: string | undefined, count: number) {
  await pool.query(
    `INSERT INTO search_queries (query, region, category, results, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (query, region, category) DO UPDATE SET
       results = EXCLUDED.results`,
    [query.toLowerCase(), region.toLowerCase(), category || null, count]
  );
}

// Query the curated catalog (google_places_v2): match query text + geo + category.
async function getCatalogResults(
  query: string,
  geo: { country?: string; region?: string },
  category?: string,
  limit = 20
) {
  const conditions: string[] = [
    `pc.source = 'google_places_v2'`,
    `pc.expires_at > NOW()`,
  ];
  const params: any[] = [];
  let n = 1;

  if (geo.country) {
    conditions.push(`pc.country = $${n++}`);
    params.push(geo.country);
  } else if (geo.region) {
    conditions.push(`pc.region ILIKE $${n++}`);
    params.push(`%${geo.region}%`);
  }

  if (category) {
    conditions.push(`pc.category = $${n++}`);
    params.push(category);
  }

  if (query && query.trim()) {
    const q = `%${query.trim()}%`;
    conditions.push(`(
      pc.name ILIKE $${n}
      OR pc.description ILIKE $${n}
      OR EXISTS (SELECT 1 FROM unnest(pc.tags) tg WHERE tg ILIKE $${n})
    )`);
    params.push(q);
    n++;
  }

  params.push(limit);

  const result = await pool.query(
    `SELECT
       pc.id, pc.external_id, pc.source, pc.name, pc.category,
       pc.description, pc.address, pc.region, pc.country, pc.latitude, pc.longitude,
       pc.phone, pc.website, pc.rating, pc.review_count, pc.price_level,
       pc.photos, pc.tags, pc.is_claimed, pc.operator_id, pc.updated_at,
       o.business_name AS claimed_business_name,
       o.tier AS operator_tier
     FROM places_cache pc
     LEFT JOIN operators o ON o.id = pc.operator_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY pc.is_claimed DESC, pc.rating DESC NULLS LAST
     LIMIT $${n}`,
    params
  );
  return result.rows;
}

// Fallback reader for live-Google rows (source='google'), used only after a Google fetch.
async function getGoogleResults(region: string, category?: string, limit = 20) {
  const result = await pool.query(
    `SELECT
       pc.id, pc.external_id, pc.source, pc.name, pc.category,
       pc.description, pc.address, pc.region, pc.country, pc.latitude, pc.longitude,
       pc.phone, pc.website, pc.rating, pc.review_count, pc.price_level,
       pc.photos, pc.tags, pc.is_claimed, pc.operator_id, pc.updated_at,
       o.business_name AS claimed_business_name,
       o.tier AS operator_tier
     FROM places_cache pc
     LEFT JOIN operators o ON o.id = pc.operator_id
     WHERE pc.source = 'google'
       AND pc.expires_at > NOW()
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
): Promise<{ results: any[]; source: 'catalog' | 'google'; total: number }> {
  const geo = resolveGeo(region);

  // 1. Curated catalog first (instant, has photos)
  const catalog = await getCatalogResults(query, geo, category, limit);
  if (catalog.length > 0) {
    return { results: catalog, source: 'catalog', total: catalog.length };
  }

  // 2. Empty catalog -> live Google fallback (kept separate as source='google')
  try {
    const places = await searchPlaces(query, region);
    const filtered = category ? places.filter(p => p.category === category) : places;
    await upsertPlaces(filtered);
    await recordQuery(query, region, category, filtered.length);
    const results = await getGoogleResults(region, category, limit);
    return { results, source: 'google', total: results.length };
  } catch (err) {
    console.error('Google Places fetch failed:', err);
    return { results: [], source: 'catalog', total: 0 };
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
         updated_at = NOW()
       WHERE id = $6`,
      [details.phone, details.website, details.description,
       details.opening_hours ? JSON.stringify(details.opening_hours) : null,
       details.region, id]
    );
  } catch (err) {
    console.error('Failed to enrich place:', err);
  }
}
