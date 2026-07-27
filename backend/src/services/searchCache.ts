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

// Reserves `n` units of today's live-fetch budget (n = number of outbound
// calls about to fire — one per thin category, plus Viator/Foursquare when
// used). Fails open on Redis errors — a broken counter must not disable
// discovery.
async function reserveFetchBudget(n: number): Promise<boolean> {
	if (n <= 0) return true;
	try {
		const key = `fetch-budget:${new Date().toISOString().slice(0, 10)}`;
		const used = await redis.incrby(key, n);
		if (used === n) await redis.expire(key, 26 * 3600);
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

// Total places (summed across all categories) a sub-area needs before it's
// worth offering as a browsable chip. Deliberately a simple v1 floor, not
// a per-category rule — sub_area_coverage still stores per-category counts
// for future refinement/dashboarding, this is just the launch gate.
const SUB_AREA_MIN_TOTAL = 5;

const CATEGORIES = ["food", "accommodation", "activity", "transport"] as const;

// A single generic "things to do" query skews heavily toward attractions —
// target each thin category so food/lodging/transport aren't starved by a
// healthy-looking activity count (previously: aggregate coverage let 18
// attraction rows mask zero hotels for a city the size of Singapore).
const CATEGORY_QUERY: Record<string, string> = {
	food: "restaurants and cafes",
	accommodation: "hotels and places to stay",
	activity: "things to do and attractions",
	transport: "car rental and transport",
};

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
		p.raw_subregion_tag,
	]);

	// Build parameterised bulk insert
	const rowPlaceholders = values
		.map((_, i) => {
			const base = i * 20;
			const params = Array.from(
				{ length: 20 },
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
       photos, opening_hours, tags, raw_data, raw_subregion_tag, updated_at, expires_at
     ) VALUES ${rowPlaceholders}
     ON CONFLICT (external_id, source) DO UPDATE SET
       name = EXCLUDED.name,
       rating = EXCLUDED.rating,
       review_count = EXCLUDED.review_count,
       photos = EXCLUDED.photos,
       raw_subregion_tag = COALESCE(EXCLUDED.raw_subregion_tag, places_cache.raw_subregion_tag),
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

// Query the catalog across BOTH sources (curated v2 + live google rows),
// for a single category (or unfiltered when category is omitted).
async function queryCatalog(
	query: string,
	geo: ResolvedGeo,
	category?: string,
	limit = 20,
	subAreaId?: string,
) {
	const params: any[] = [];
	const geoRes = geoConditions(geo, params, 1);
	const conditions: string[] = [
		`pc.source IN ('google_places_v2', 'google', 'foursquare', 'viator')`,
		`pc.expires_at > NOW()`,
	];
	let n = geoRes.nextIndex;
	if (subAreaId) {
		conditions.push(`pc.sub_area_id = $${n++}`);
		params.push(subAreaId);
	}
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

// Browse mode (no category filter) used to sort the whole candidate pool
// by rating alone — a handful of 5-star car-rental listings could crowd
// out food/lodging/activities on the served page even when the catalog
// itself is well balanced (e.g. Windhoek: catalog had ~20 rows in every
// category, but transport dominated 13/20 of what was actually shown).
// Query each category separately and interleave so the page reflects the
// catalog's real diversity.
async function getCatalogResults(
	query: string,
	geo: ResolvedGeo,
	category?: string,
	limit = 20,
	subAreaId?: string,
) {
	if (category) return queryCatalog(query, geo, category, limit, subAreaId);

	const perCategoryLimit = Math.ceil(limit / CATEGORIES.length);
	const perCategory = await Promise.all(
		CATEGORIES.map((cat) =>
			queryCatalog(query, geo, cat, perCategoryLimit, subAreaId),
		),
	);
	const interleaved: any[] = [];
	const maxLen = Math.max(...perCategory.map((rows) => rows.length));
	for (let i = 0; i < maxLen; i++) {
		for (const rows of perCategory) {
			if (rows[i]) interleaved.push(rows[i]);
		}
	}
	return interleaved.slice(0, limit);
}

// Sub-areas offered for a searched region. Gated entirely by the
// precomputed sub_area_coverage snapshot from scripts/resolve-sub-areas.ts
// — never checked live, so what's offered is always what's actually there.
export async function getSubregions(
	region: string,
): Promise<{ name: string; slug: string; count: number }[]> {
	const geo = await resolveGeo(region);
	const canonicalRegion = geo.point?.name || region;

	const { rows } = await pool.query(
		`SELECT sa.canonical_name AS name, sa.canonical_slug AS slug,
            SUM(sac.row_count) AS total
     FROM sub_areas sa
     JOIN sub_area_coverage sac ON sac.sub_area_id = sa.id
     WHERE sa.region = $1
     GROUP BY sa.id, sa.canonical_name, sa.canonical_slug
     HAVING SUM(sac.row_count) >= $2
     ORDER BY total DESC`,
		[canonicalRegion, SUB_AREA_MIN_TOTAL],
	);

	return rows.map((r) => ({
		name: r.name,
		slug: r.slug,
		count: parseInt(r.total, 10),
	}));
}

export async function search(
	query: string,
	region: string,
	category?: string,
	limit = 20,
	subArea?: string,
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

	// Sub-area is a post-hoc grouping of already-cached places, resolved by
	// the offline batch job (scripts/resolve-sub-areas.ts) — never fetched
	// or decided live here. Unknown/misspelled slugs just return no filter
	// match rather than erroring, so a stale bookmark doesn't break search.
	let subAreaId: string | undefined;
	if (subArea) {
		const slug = subArea.toLowerCase().trim();
		const { rows } = await pool.query(
			`SELECT id FROM sub_areas WHERE region = $1 AND canonical_slug = $2 LIMIT 1`,
			[canonicalRegion, slug],
		);
		subAreaId = rows[0]?.id;
	}

	// 1. Coverage check: top up from live sources when the catalog is thin,
	// per category — not in aggregate (see CATEGORY_QUERY comment above).
	// Sources fan out in parallel; one failing source never blocks the rest.
	let fetchedLive = false;
	try {
		const userQuery = query.trim();
		const categoriesToCheck = category ? [category] : CATEGORIES;
		const coverageByCategory = await Promise.all(
			categoriesToCheck.map(async (cat) => ({
				cat,
				coverage: await coverageCount(geo, cat),
			})),
		);
		const thinCategories = coverageByCategory
			.filter((c) => c.coverage < MIN_COVERAGE)
			.map((c) => c.cat);

		const wantTours = thinCategories.includes("activity");
		const willCallViator = wantTours && viatorEnabled() && !!geo.point;
		const willCallFoursquare =
			thinCategories.length > 0 && foursquareEnabled() && !!geo.point;
		const totalCalls =
			thinCategories.length +
			(willCallViator ? 1 : 0) +
			(willCallFoursquare ? 1 : 0);

		if (totalCalls > 0 && (await reserveFetchBudget(totalCalls))) {
			const [googleSettled, viator, foursquare] = await Promise.allSettled([
				Promise.allSettled(
					thinCategories.map((cat) =>
						searchPlaces(
							userQuery || CATEGORY_QUERY[cat],
							canonicalRegion,
							geo.point ?? null,
						),
					),
				),
				willCallViator
					? searchViatorProducts(geo.point!.name, geo.point!.country)
					: Promise.resolve([] as PlaceResult[]),
				willCallFoursquare
					? searchFoursquare(
							userQuery || "highlights",
							geo.point!.name,
							geo.point!,
						)
					: Promise.resolve([] as PlaceResult[]),
			]);

			const fetched: PlaceResult[] = [];
			if (googleSettled.status === "fulfilled") {
				for (const r of googleSettled.value) {
					if (r.status === "fulfilled") fetched.push(...r.value);
					else
						console.error("Google category fetch failed:", r.reason?.message);
				}
			}
			if (viator.status === "fulfilled") fetched.push(...viator.value);
			else console.error("Viator fetch failed:", viator.reason?.message);
			if (foursquare.status === "fulfilled") fetched.push(...foursquare.value);
			else
				console.error("Foursquare fetch failed:", foursquare.reason?.message);

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
	const rows = await getCatalogResults(query, geo, category, limit * 2, subAreaId);
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
