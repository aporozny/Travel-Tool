import { pool } from "../utils/db";
import { redis } from "../utils/redis";
import { searchPlaces, getPlaceDetails, PlaceResult } from "./googlePlaces";
import { geocodeDestination, GeoResult } from "./geocoding";
import { searchViatorProducts, viatorEnabled } from "./viator";
import { searchFoursquare, foursquareEnabled } from "./foursquare";
import { dedupPlaces } from "./dedup";
import { getSocialSignals } from "./recommendations";

// Daily cap on live external fan-outs (R2: cost control). Over budget the
// app serves catalog-only until midnight UTC. Override per environment.
const FETCH_DAILY_BUDGET = parseInt(
	process.env.FETCH_DAILY_BUDGET || "200",
	10,
);

// Returns true when this fan-out is within today's budget. Fails open on
// Redis errors — a broken counter must not disable discovery.
async function withinFetchBudget(): Promise<boolean> {
	try {
		const key = `fetch-budget:${new Date().toISOString().slice(0, 10)}`;
		const used = await redis.incr(key);
		if (used === 1) await redis.expire(key, 26 * 3600);
		if (used > FETCH_DAILY_BUDGET) {
			console.warn(
				`Fetch budget exhausted (${used}/${FETCH_DAILY_BUDGET}) — catalog-only until midnight UTC`,
			);
			return false;
		}
		return true;
	} catch {
		return true;
	}
}

const CACHE_TTL_DAYS = 30;

// Below this many fresh rows per category near a destination we top up from
// the live source. Prevents a handful of stale rows suppressing refresh forever.
export const MIN_COVERAGE = 12;

interface ResolvedGeo {
	country?: string;
	region?: string;
	point?: GeoResult;
}

// Geocode the destination (cached, 90d). Falls back to plain region matching
// when geocoding is unavailable so search never hard-fails.
async function resolveGeo(term: string): Promise<ResolvedGeo> {
	if (!term) return {};
	const point = await geocodeDestination(term);
	if (point)
		return { point, region: term, country: point.country || undefined };
	return { region: term };
}

// Bulk upsert - single round trip for all places
async function upsertPlaces(places: PlaceResult[]): Promise<void> {
	if (places.length === 0) return;

	const values = places.map((p) => [
		p.external_id,
		p.source,
		p.name,
		p.category,
		p.description,
		p.address,
		p.region,
		p.country,
		p.latitude,
		p.longitude,
		p.phone,
		p.website,
		p.rating,
		p.review_count,
		p.price_level,
		JSON.stringify(p.photos), // photo references, not full URLs
		p.opening_hours ? JSON.stringify(p.opening_hours) : null,
		p.tags,
		JSON.stringify(p.raw_data),
	]);

	// Build parameterised bulk insert
	const rowPlaceholders = values
		.map((_, i) => {
			const base = i * 19;
			const params = Array.from(
				{ length: 19 },
				(_, j) => `$${base + j + 1}`,
			).join(", ");
			return `(${params}, NOW(), NOW() + INTERVAL '${CACHE_TTL_DAYS} days')`;
		})
		.join(", ");

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
		flatValues,
	);
}

async function recordQuery(
	query: string,
	region: string,
	category: string | undefined,
	count: number,
) {
	await pool.query(
		`INSERT INTO search_queries (query, region, category, results, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (query, region, category) DO UPDATE SET
       results = EXCLUDED.results`,
		[query.toLowerCase(), region.toLowerCase(), category || null, count],
	);
}

// Geo filter: bounding box around the geocoded point when available,
// else country match, else region ILIKE. Shared by catalog reads and coverage.
function geoConditions(
	geo: ResolvedGeo,
	params: any[],
	startIndex: number,
): { sql: string[]; nextIndex: number } {
	const sql: string[] = [];
	let n = startIndex;
	if (geo.point) {
		// ~1 deg latitude = 111km; longitude shrinks by cos(lat)
		const latDelta = geo.point.radiusMeters / 111_000;
		const lngDelta =
			geo.point.radiusMeters /
			(111_000 * Math.max(0.2, Math.cos((geo.point.latitude * Math.PI) / 180)));
		sql.push(`pc.latitude BETWEEN $${n} AND $${n + 1}`);
		params.push(geo.point.latitude - latDelta, geo.point.latitude + latDelta);
		n += 2;
		sql.push(`pc.longitude BETWEEN $${n} AND $${n + 1}`);
		params.push(geo.point.longitude - lngDelta, geo.point.longitude + lngDelta);
		n += 2;
	} else if (geo.country) {
		sql.push(`pc.country = $${n++}`);
		params.push(geo.country);
	} else if (geo.region) {
		sql.push(`pc.region ILIKE $${n++}`);
		params.push(`%${geo.region}%`);
	}
	return { sql, nextIndex: n };
}

// Count fresh rows near the destination for a category — the refresh decision.
export async function coverageCount(
	geo: ResolvedGeo,
	category?: string,
): Promise<number> {
	const params: any[] = [];
	const { sql, nextIndex } = geoConditions(geo, params, 1);
	const conditions = [`pc.expires_at > NOW()`, ...sql];
	let n = nextIndex;
	if (category) {
		conditions.push(`pc.category = $${n++}`);
		params.push(category);
	}
	const result = await pool.query(
		`SELECT COUNT(*) AS c FROM places_cache pc WHERE ${conditions.join(" AND ")}`,
		params,
	);
	return parseInt(result.rows[0].c, 10);
}

// Query the catalog across BOTH sources (curated v2 + live google rows).
async function getCatalogResults(
	query: string,
	geo: ResolvedGeo,
	category?: string,
	limit = 20,
) {
	const params: any[] = [];
	const geoRes = geoConditions(geo, params, 1);
	const conditions: string[] = [
		`pc.source IN ('google_places_v2', 'google', 'foursquare', 'viator')`,
		`pc.expires_at > NOW()`,
	];
	let n = geoRes.nextIndex;
	// Viator products carry no coordinates — match them by region name while
	// POI sources use the geo filter.
	if (geoRes.sql.length > 0 && geo.region) {
		conditions.push(
			`((${geoRes.sql.join(" AND ")}) OR (pc.source = 'viator' AND pc.region ILIKE $${n}))`,
		);
		params.push(`%${geo.region}%`);
		n++;
	} else {
		conditions.push(...geoRes.sql);
	}

	if (category) {
		conditions.push(`pc.category = $${n++}`);
		params.push(category);
	}

	if (query && query.trim()) {
		const raw = query.trim();
		const q = `%${raw}%`;
		// Singular fallback so "restaurants" matches tag/name "restaurant"
		const qs = `%${raw.replace(/s$/i, "")}%`;
		conditions.push(`(
      pc.name ILIKE $${n} OR pc.name ILIKE $${n + 1}
      OR pc.description ILIKE $${n} OR pc.description ILIKE $${n + 1}
      OR EXISTS (SELECT 1 FROM unnest(pc.tags) tg WHERE tg ILIKE $${n} OR tg ILIKE $${n + 1})
    )`);
		params.push(q, qs);
		n += 2;
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
     WHERE ${conditions.join(" AND ")}
     ORDER BY pc.is_claimed DESC, pc.rating DESC NULLS LAST
     LIMIT $${n}`,
		params,
	);
	return result.rows;
}

export async function search(
	query: string,
	region: string,
	category?: string,
	limit = 20,
): Promise<{
	results: any[];
	source: "catalog" | "google";
	total: number;
	geo: { name: string; country: string } | null;
}> {
	const geo = await resolveGeo(region);
	// Store and report under the geocoded canonical name so "lisbon portugal"
	// and "Lisbon" share one catalog identity.
	const canonicalRegion = geo.point?.name || region;

	// 1. Coverage check: top up from live sources when the catalog is thin
	// near this destination, not only when it is empty. Sources fan out in
	// parallel; one failing source never blocks the others.
	let fetchedLive = false;
	try {
		const coverage = await coverageCount(geo, category);
		if (coverage < MIN_COVERAGE && (await withinFetchBudget())) {
			// Browse mode (no q): ask the live source for general highlights
			const liveQuery = query.trim() || "things to do";
			const wantTours = !category || category === "activity";
			const [google, viator, foursquare] = await Promise.allSettled([
				searchPlaces(liveQuery, canonicalRegion, geo.point ?? null),
				wantTours && viatorEnabled() && geo.point
					? searchViatorProducts(geo.point.name, geo.point.country)
					: Promise.resolve([] as PlaceResult[]),
				foursquareEnabled() && geo.point
					? searchFoursquare(liveQuery, geo.point.name, geo.point)
					: Promise.resolve([] as PlaceResult[]),
			]);
			const fetched: PlaceResult[] = [];
			for (const r of [google, viator, foursquare]) {
				if (r.status === "fulfilled") fetched.push(...r.value);
				else console.error("Source fetch failed:", r.reason?.message);
			}
			const filtered = category
				? fetched.filter(
						(p) => p.category === category || p.source === "viator",
					)
				: fetched;
			await upsertPlaces(filtered);
			fetchedLive = filtered.length > 0;
		}
	} catch (err) {
		console.error("Live places top-up failed:", err);
		// degrade to whatever the catalog has
	}

	// 2. Serve from the catalog (all sources), deduped across sources.
	const rows = await getCatalogResults(query, geo, category, limit * 2);
	const results = dedupPlaces(rows).slice(0, limit);

	// Attach community interest (saves/books) for result-card social proof.
	// Same signal source the personalized recommendations service uses.
	let resultsWithCommunity = results;
	try {
		const social = await getSocialSignals(results.map((r) => r.id));
		resultsWithCommunity = results.map((r) => ({
			...r,
			community: {
				saves: social.get(r.id)?.saves || 0,
				books: social.get(r.id)?.books || 0,
			},
		}));
	} catch (err) {
		console.error("getSocialSignals failed:", err);
	}

	// Telemetry: record what was ultimately served (zero-result queries are
	// the signal — they show where the catalog fails users).
	try {
		await recordQuery(
			query || "(browse)",
			canonicalRegion,
			category,
			results.length,
		);
	} catch (err) {
		console.error("recordQuery failed:", err);
	}

	return {
		results: resultsWithCommunity,
		source: fetchedLive ? "google" : "catalog",
		total: results.length,
		geo: geo.point
			? { name: geo.point.name, country: geo.point.country }
			: null,
	};
}

export async function getPlaceById(id: string) {
	const result = await pool.query(
		`SELECT pc.*, o.business_name AS claimed_business_name, o.tier AS operator_tier
     FROM places_cache pc
     LEFT JOIN operators o ON o.id = pc.operator_id
     WHERE pc.id = $1`,
		[id],
	);
	return result.rows[0] || null;
}

export async function enrichPlace(
	id: string,
	externalId: string,
): Promise<void> {
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
			[
				details.phone,
				details.website,
				details.description,
				details.opening_hours ? JSON.stringify(details.opening_hours) : null,
				details.region,
				id,
			],
		);
	} catch (err) {
		console.error("Failed to enrich place:", err);
	}
}
