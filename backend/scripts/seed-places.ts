import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../src/utils/db';
import { searchPlaces } from '../src/services/googlePlaces';

const REGIONS = [
  'Seminyak Bali', 'Canggu Bali', 'Ubud Bali', 'Uluwatu Bali',
  'Nusa Penida Bali', 'Amed Bali', 'Sanur Bali', 'Kuta Bali',
  'Lombok Indonesia', 'Gili Islands Indonesia',
  'Labuan Bajo Indonesia', 'Raja Ampat Indonesia',
];

const QUERIES = [
  { q: 'restaurants', category: 'food' },
  { q: 'hotels resorts villas', category: 'accommodation' },
  { q: 'scuba diving snorkeling', category: 'activity' },
  { q: 'things to do activities tours', category: 'activity' },
];

const CACHE_TTL_DAYS = 30;

async function upsertPlace(place: any, region: string): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO places_cache (
         external_id, source, name, category, description, address, region, country,
         latitude, longitude, phone, website, rating, review_count, price_level,
         photos, opening_hours, tags, raw_data, last_fetched_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW() + INTERVAL '30 days')
       ON CONFLICT (external_id, source) DO UPDATE SET
         name = EXCLUDED.name, rating = EXCLUDED.rating,
         review_count = EXCLUDED.review_count, photos = EXCLUDED.photos,
         region = EXCLUDED.region, last_fetched_at = NOW(),
         expires_at = NOW() + INTERVAL '30 days'`,
      [
        place.external_id, place.source, place.name, place.category,
        place.description, place.address, region.split(' ')[0], 'Indonesia',
        place.latitude, place.longitude, place.phone, place.website,
        place.rating, place.review_count, place.price_level,
        JSON.stringify(place.photos),
        place.opening_hours ? JSON.stringify(place.opening_hours) : null,
        place.tags, JSON.stringify({ place_id: place.external_id }),
      ]
    );
    return true;
  } catch (err: any) {
    if (!err.message?.includes('unique')) console.error(`  Insert error: ${err.message}`);
    return false;
  }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Drift data seeding started\n');
  let total = 0;

  for (const region of REGIONS) {
    console.log(`📍 ${region}`);
    for (const { q, category } of QUERIES) {
      try {
        process.stdout.write(`   ${q.padEnd(35)}`);
        const places = await searchPlaces(q, region);
        let inserted = 0;
        for (const p of places) { if (await upsertPlace(p, region)) inserted++; }
        await pool.query(
          `INSERT INTO search_queries (query, region, category, result_count, last_searched_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (query, region, COALESCE(category,'')) DO UPDATE SET result_count=$4, last_searched_at=NOW()`,
          [q.toLowerCase(), region.toLowerCase(), category, places.length]
        );
        console.log(`${places.length} results, ${inserted} new`);
        total += inserted;
        await sleep(250);
      } catch (err: any) {
        console.log(`ERROR: ${err.message}`);
        await sleep(1500);
      }
    }
  }

  const summary = await pool.query(
    `SELECT region, COUNT(*) as count FROM places_cache WHERE expires_at > NOW() GROUP BY region ORDER BY count DESC`
  );
  console.log(`\nTotal inserted: ${total}`);
  console.log('\nDatabase summary:');
  for (const r of summary.rows) console.log(`  ${r.region.padEnd(25)} ${r.count}`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
