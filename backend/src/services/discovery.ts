import { pool } from "../utils/db";

// Replaces a hardcoded destination list with a live query -- eligibility
// is computed from the real catalog, never hand-picked. An empty-by-
// default override table would be a reasonable escape hatch later
// (blocklist bad automated picks, not an allowlist that becomes the real
// mechanism) but isn't needed yet; nothing here is curated by hand.

export interface DestinationSummary {
	region: string;
	country: string;
	placeCount: number;
	categoryCount: number;
}

// "Popular starting points": deep enough that a tap won't land on a thin/
// broken-looking page. Same catalog sources search already trusts.
const FEATURED_MIN_PLACES = 40;
const FEATURED_MIN_CATEGORIES = 3;

// "Somewhere new": a separate, lower bar for genuinely long-tail
// destinations -- 12 matches MIN_COVERAGE (searchCache.ts), the same
// floor the search/live-fetch pipeline already treats as "not broken".
// One bar can't serve both jobs: gating "somewhere new" at the featured
// bar would defeat its entire purpose (surfacing what's NOT already
// deep), and dropping the floor for everything would let genuinely thin
// destinations into the main picks.
const NEW_MIN_PLACES = 12;
const NEW_MIN_CATEGORIES = 2;

async function getDestinationSummaries(): Promise<DestinationSummary[]> {
	// A real geocoded destination always resolves to a country. An empty
	// one is a reliable signal of garbage/malformed input (a typo search
	// Google couldn't confidently resolve, e.g. a stray "dubva" that made
	// it into the catalog with 0 category diversity worth of real
	// content) -- exclude it here rather than needing a manual blocklist
	// for every case like it.
	const { rows } = await pool.query(`
		SELECT region, MAX(country) AS country,
		       COUNT(*) AS place_count, COUNT(DISTINCT category) AS category_count
		FROM places_cache
		WHERE expires_at > NOW()
		  AND source IN ('google_places_v2', 'google', 'foursquare', 'viator')
		  AND country IS NOT NULL AND country != ''
		GROUP BY region
	`);
	return rows.map((r) => ({
		region: r.region,
		country: r.country || "",
		placeCount: parseInt(r.place_count, 10),
		categoryCount: parseInt(r.category_count, 10),
	}));
}

// Deterministic daily shuffle (stable within a day, rotates the next) --
// avoids a jarring reshuffle on every page load while still not being a
// fixed list forever.
function dailySeed(): number {
	const today = new Date().toISOString().slice(0, 10);
	let hash = 0;
	for (let i = 0; i < today.length; i++) {
		hash = (hash * 31 + today.charCodeAt(i)) | 0;
	}
	return Math.abs(hash);
}

function seededShuffle<T>(items: T[], seed: number): T[] {
	const arr = [...items];
	let s = seed || 1;
	for (let i = arr.length - 1; i > 0; i--) {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		const j = s % (i + 1);
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

// Geographic diversity without a continent-taxonomy dependency: greedily
// pick from the shuffled pool while skipping destinations whose country
// is already represented, so "5 Bali towns" can't happen even though
// they'd otherwise dominate any unweighted sample. Falls back to
// allowing repeats only if there aren't enough distinct countries to
// fill the request.
function pickGeographicallyDiverse(
	pool: DestinationSummary[],
	n: number,
	seed: number,
): DestinationSummary[] {
	const shuffled = seededShuffle(pool, seed);
	const picked: DestinationSummary[] = [];
	const usedCountries = new Set<string>();
	for (const d of shuffled) {
		if (picked.length >= n) break;
		if (usedCountries.has(d.country)) continue;
		picked.push(d);
		usedCountries.add(d.country);
	}
	if (picked.length < n) {
		for (const d of shuffled) {
			if (picked.length >= n) break;
			if (picked.includes(d)) continue;
			picked.push(d);
		}
	}
	return picked;
}

export interface DiscoveryDestinations {
	featured: { region: string; country: string }[];
	somewhereNew: { region: string; country: string }[];
}

export async function getDiscoveryDestinations(): Promise<DiscoveryDestinations> {
	const all = await getDestinationSummaries();
	const featuredPool = all.filter(
		(d) => d.placeCount >= FEATURED_MIN_PLACES && d.categoryCount >= FEATURED_MIN_CATEGORIES,
	);
	const featuredRegions = new Set(featuredPool.map((d) => d.region));
	const somewhereNewPool = all.filter(
		(d) =>
			!featuredRegions.has(d.region) &&
			d.placeCount >= NEW_MIN_PLACES &&
			d.categoryCount >= NEW_MIN_CATEGORIES,
	);

	const seed = dailySeed();
	const featured = pickGeographicallyDiverse(featuredPool, 6, seed).map((d) => ({
		region: d.region,
		country: d.country,
	}));
	const somewhereNew = pickGeographicallyDiverse(somewhereNewPool, 2, seed + 1).map((d) => ({
		region: d.region,
		country: d.country,
	}));

	return { featured, somewhereNew };
}

export interface SpotlightPlace {
	id: string;
	type: "place";
	name: string;
	category: string;
	region: string;
	country: string;
	rating: number | null;
	review_count: number;
	price_level: number | null;
	photos: string[];
	tags: string[];
	is_claimed: boolean;
}

// A small, honestly-editorial preview for the unscoped screen -- NOT a
// "For you" feed. Two places per featured destination (rating-sorted,
// diverse category via ORDER BY, not a personalization score), so no
// single deep destination can dominate what a brand new or logged-out
// user sees before picking anywhere. Deliberately excludes the
// personalization pipeline entirely (no score, no % match).
export async function getSpotlightPlaces(
	regions: string[],
	perRegion = 2,
): Promise<SpotlightPlace[]> {
	if (regions.length === 0) return [];
	const { rows } = await pool.query(
		`SELECT id, name, category, region, country, rating, review_count,
		        price_level, photos, tags, is_claimed
		 FROM (
		   SELECT pc.*, ROW_NUMBER() OVER (
		     PARTITION BY pc.region ORDER BY pc.is_claimed DESC, pc.rating DESC NULLS LAST
		   ) AS rn
		   FROM places_cache pc
		   WHERE pc.region = ANY($1)
		     AND pc.expires_at > NOW()
		     AND pc.source IN ('google_places_v2', 'google', 'foursquare', 'viator')
		 ) ranked
		 WHERE rn <= $2
		 ORDER BY region, rn`,
		[regions, perRegion],
	);
	return rows.map((r) => ({
		id: r.id,
		type: "place" as const,
		name: r.name,
		category: r.category,
		region: r.region,
		country: r.country,
		rating: r.rating ? parseFloat(r.rating) : null,
		review_count: parseInt(r.review_count, 10) || 0,
		price_level: r.price_level,
		photos: Array.isArray(r.photos) ? r.photos : r.photos ? JSON.parse(r.photos) : [],
		tags: r.tags || [],
		is_claimed: r.is_claimed || false,
	}));
}
