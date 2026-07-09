import { pool } from "../utils/db";
import { redis } from "../utils/redis";

// Budget level mapping: member preference → operator price_level range
const BUDGET_MAP: Record<string, number[]> = {
	budget: [1, 2],
	mid: [1, 2, 3],
	upper_mid: [2, 3, 4],
	luxury: [3, 4],
	ultra_luxury: [4],
};

// Map member activity preferences to operator tags
const ACTIVITY_TAG_MAP: Record<string, string[]> = {
	scuba_diving: ["scuba_diving", "diving"],
	snorkeling: ["snorkeling", "diving"],
	surfing: ["surfing", "surf_camp"],
	sup: ["sup", "water_sports"],
	sailing: ["sailing", "boat_charter"],
	fishing: ["fishing"],
	freediving: ["freediving", "diving"],
	kitesurfing: ["kitesurfing", "water_sports"],
	swimming: ["swimming", "pool"],
	hiking: ["hiking", "trekking"],
	cycling: ["cycling"],
	motorbike_touring: ["motorbike_rental", "motorbike_touring"],
	rock_climbing: ["rock_climbing"],
	canyoning: ["canyoning"],
	paragliding: ["paragliding"],
	yoga: ["yoga", "yoga_retreat"],
	meditation: ["meditation", "wellness"],
	spa_massage: ["spa_massage", "spa"],
	sound_healing: ["sound_healing", "wellness"],
	detox: ["detox", "wellness", "yoga_retreat"],
	breathwork: ["breathwork", "wellness"],
	ayurveda: ["ayurveda", "wellness"],
	cooking_classes: ["cooking_classes"],
	market_visits: ["market_visits", "food_tour"],
	food_tours: ["food_tour", "food_experiences"],
};

const DIETARY_TAG_MAP: Record<string, string[]> = {
	vegetarian: ["vegetarian", "vegetarian_friendly"],
	vegan: ["vegan", "vegan_friendly", "vegetarian"],
	halal: ["halal", "halal_certified"],
	gluten_free: ["gluten_free"],
	dairy_free: ["dairy_free"],
	nut_allergy: ["nut_free"],
	shellfish_allergy: ["shellfish_free"],
	pescatarian: ["pescatarian", "seafood"],
	kosher: ["kosher"],
	jain: ["jain", "vegetarian"],
};

const ACCOMMODATION_TAG_MAP: Record<string, string[]> = {
	private_villa: ["private_villa", "villa"],
	boutique_hotel: ["boutique_hotel", "hotel"],
	resort: ["resort"],
	homestay: ["homestay", "guesthouse"],
	hostel: ["hostel", "dorm"],
	airbnb: ["apartment", "airbnb"],
	eco_lodge: ["eco_lodge", "eco"],
	liveaboard: ["liveaboard"],
	surf_camp: ["surf_camp", "surfing"],
	yoga_retreat: ["yoga_retreat", "yoga"],
};

const MUST_HAVE_TAG_MAP: Record<string, string[]> = {
	private_pool: ["private_pool"],
	air_conditioning: ["air_conditioning", "ac"],
	fast_wifi: ["fast_wifi", "wifi"],
	kitchen: ["kitchen", "self_catering"],
	beach_access: ["beach_access", "beachfront"],
	nature_view: ["rice_field_view", "nature_view", "jungle"],
	pet_friendly: ["pet_friendly"],
	child_friendly: ["child_friendly", "family_friendly"],
};

export interface RecommendationResult {
	id: string;
	type: "operator" | "place";
	name: string;
	category: string;
	description: string | null;
	region: string;
	address: string | null;
	latitude: number | null;
	longitude: number | null;
	rating: number | null;
	review_count: number;
	price_level: number | null;
	photos: string[];
	tags: string[];
	is_claimed: boolean;
	is_verified: boolean;
	score: number;
	score_breakdown: {
		activity: number;
		budget: number;
		region: number;
		dietary: number;
		accommodation: number;
		rating_boost: number;
		claimed_bonus: number;
	};
	website: string | null;
	phone: string | null;
}

interface MemberPreferences {
	travel_style: string[];
	budget_range: string;
	accommodation_budget_aud: string;
	splurge_categories: string[];
	accommodation_types: string[];
	accommodation_must_haves: string[];
	dietary_requirements: string[];
	food_adventurousness: string;
	cuisine_preferences: string[];
	dining_style: string;
	water_activities: string[];
	land_activities: string[];
	wellness_interests: string[];
	cultural_interests: string[];
	nightlife_preference: string;
	adrenaline_level: string;
	nature_interests: string[];
	sustainability_commitment: string;
	fitness_level: string;
	regions_visited: string[];
	bucket_list_regions: string[];
	bali_areas_interest: string[];
	next_trip_timing: string;
	onboarding_completed: boolean;
}

// Bayesian-adjusted rating: pulls low-volume ratings toward the prior so a
// 5.0 with one review cannot outrank a 4.7 with thousands.
// R = (v/(v+m))*rating + (m/(v+m))*prior
export const BAYES_M = 50;
export const BAYES_PRIOR = 3.8;

export function bayesianRating(
	rating: number,
	reviewCount: number,
	m: number = BAYES_M,
	prior: number = BAYES_PRIOR,
): number {
	if (!rating || rating <= 0) return prior * 0.9; // unrated: slightly below prior
	const v = Math.max(0, reviewCount || 0);
	return (v / (v + m)) * rating + (m / (v + m)) * prior;
}

// Verified/claimed businesses get a visibility nudge, never dominance.
export const MAX_TIER_BONUS = 8;

// Score weights (sum = 100):
//   personal fit 30 | budget 15 | region 15 | quality 25 | popularity 7 | tier 8
// Breakdown keys are kept identical to the previous version for frontend
// compatibility: `activity`/`dietary`/`accommodation` hold the personal-fit
// contribution for the item's own category; `rating_boost` holds
// quality+popularity.
export function scoreOperator(
	op: any,
	prefs: MemberPreferences,
	targetRegion?: string,
): RecommendationResult["score_breakdown"] {
	const breakdown = {
		activity: 0,
		budget: 0,
		region: 0,
		dietary: 0,
		accommodation: 0,
		rating_boost: 0,
		claimed_bonus: 0,
	};

	const opTags: string[] = op.tags || [];
	const category: string = op.category || "activity";

	// --- Personal fit (0-30), scored against the item's own category only ---
	if (category === "accommodation") {
		const accTypes = prefs.accommodation_types || [];
		const mustHaves = prefs.accommodation_must_haves || [];
		let fit = 0;
		for (const type of accTypes) {
			const mappedTags = ACCOMMODATION_TAG_MAP[type] || [type];
			if (mappedTags.some((t) => opTags.includes(t))) {
				fit += 20;
				break;
			}
		}
		let mustHits = 0;
		for (const must of mustHaves) {
			const mappedTags = MUST_HAVE_TAG_MAP[must] || [must];
			if (mappedTags.some((t) => opTags.includes(t))) mustHits++;
		}
		if (mustHaves.length > 0) {
			fit += Math.round((mustHits / mustHaves.length) * 10);
		}
		breakdown.accommodation = Math.min(fit, 30);
	} else if (category === "food") {
		const dietary = (prefs.dietary_requirements || []).filter(
			(d) => d !== "none",
		);
		if (dietary.length === 0) {
			breakdown.dietary = 20; // no restrictions: any food venue fits
		} else {
			let hits = 0;
			for (const req of dietary) {
				const mappedTags = DIETARY_TAG_MAP[req] || [req];
				if (mappedTags.some((t) => opTags.includes(t))) hits++;
			}
			breakdown.dietary = Math.round((hits / dietary.length) * 20);
		}
		// Food-experience interests (food tours, cooking classes, markets)
		const foodInterests = ["food_tours", "cooking_classes", "market_visits"];
		const wanted = foodInterests.filter(
			(f) =>
				(prefs.cultural_interests || []).includes(f) ||
				(prefs.land_activities || []).includes(f),
		);
		for (const w of wanted) {
			const mappedTags = ACTIVITY_TAG_MAP[w] || [w];
			if (mappedTags.some((t) => opTags.includes(t))) {
				breakdown.dietary = Math.min(breakdown.dietary + 10, 30);
				break;
			}
		}
	} else {
		// activities, tours, transport, everything else: activity-tag match
		const allActivities = [
			...(prefs.water_activities || []),
			...(prefs.land_activities || []),
			...(prefs.wellness_interests || []),
		];
		let matches = 0;
		for (const activity of allActivities) {
			const mappedTags = ACTIVITY_TAG_MAP[activity] || [activity];
			if (mappedTags.some((t) => opTags.includes(t))) matches++;
		}
		if (allActivities.length > 0) {
			breakdown.activity = Math.round((matches / allActivities.length) * 30);
		}
	}

	// --- Budget score (0-15) ---
	const budgetRange = BUDGET_MAP[prefs.budget_range] || [1, 2, 3, 4];
	const opPriceLevel = op.price_level || 2;
	if (budgetRange.includes(opPriceLevel)) {
		breakdown.budget = 15;
	} else {
		const minBudget = Math.min(...budgetRange);
		const maxBudget = Math.max(...budgetRange);
		const distance = Math.min(
			Math.abs(opPriceLevel - minBudget),
			Math.abs(opPriceLevel - maxBudget),
		);
		breakdown.budget = Math.max(0, 15 - distance * 6);
	}

	// --- Region score (0-15) ---
	const opRegion = (op.region || "").toLowerCase();
	if (targetRegion && opRegion.includes(targetRegion.toLowerCase())) {
		breakdown.region = 15;
	} else {
		const bucketList = prefs.bucket_list_regions || [];
		const baliAreas = prefs.bali_areas_interest || [];
		const allTargetRegions = [...bucketList, ...baliAreas];

		const regionMatch = allTargetRegions.some(
			(r) =>
				opRegion.includes(r.toLowerCase().replace(/_/g, " ")) ||
				r.toLowerCase().replace(/_/g, " ").includes(opRegion),
		);

		if (regionMatch) {
			breakdown.region =
				prefs.next_trip_timing === "planning_now"
					? 13
					: prefs.next_trip_timing === "next_6_months"
						? 10
						: 7;
		}
	}

	// --- Quality (0-25) + popularity (0-7), combined in rating_boost ---
	const rating = parseFloat(op.rating) || 0;
	const reviewCount = parseInt(op.review_count) || 0;
	const adjusted = bayesianRating(rating, reviewCount);
	// Map adjusted rating (realistic range ~3.0–5.0) onto 0–25
	const quality = Math.max(0, Math.min(25, ((adjusted - 3.0) / 2.0) * 25));
	// log10 popularity: 10 reviews ≈ 2.3pts, 100 ≈ 4.7, 1000+ ≈ 7
	const popularity = Math.min(7, Math.log10(reviewCount + 1) * 2.33);
	breakdown.rating_boost = Math.round(quality + popularity);

	// --- Verified/claimed bonus, capped ---
	if (op.is_verified) {
		breakdown.claimed_bonus = MAX_TIER_BONUS;
	} else if (op.is_claimed) {
		breakdown.claimed_bonus = 4;
	}

	return breakdown;
}

function totalScore(
	breakdown: RecommendationResult["score_breakdown"],
): number {
	return Object.values(breakdown).reduce((sum, v) => sum + v, 0);
}

// Fetch member preferences from DB
async function getMemberPreferences(
	userId: string,
): Promise<MemberPreferences | null> {
	const result = await pool.query(
		`SELECT mp.*
     FROM member_preferences mp
     JOIN travelers t ON t.id = mp.traveler_id
     WHERE t.user_id = $1`,
		[userId],
	);
	return result.rows[0] || null;
}

// Main recommendation function
export async function getRecommendations(
	userId: string | null,
	options: {
		category?: string;
		region?: string;
		limit?: number;
		forceRefresh?: boolean;
	} = {},
): Promise<RecommendationResult[]> {
	const { category, region, limit = 20, forceRefresh = false } = options;

	// Check recommendation cache for authenticated users
	if (userId && !forceRefresh) {
		const cacheKey = `rec:${userId}:${category || "all"}:${region || "all"}`;
		const cached = await redis.get(cacheKey);
		if (cached) {
			return JSON.parse(cached).slice(0, limit);
		}
	}

	// Fetch operators from DB
	let opQuery = `
    SELECT o.id, 'operator' AS type, o.business_name AS name, o.category,
           o.description, o.region, o.address,
           ST_Y(o.location::geometry) AS latitude,
           ST_X(o.location::geometry) AS longitude,
           o.website, o.phone, o.tags, o.price_level, o.images AS photos,
           o.is_verified, true AS is_claimed,
           COALESCE(AVG(r.rating), 0) AS rating,
           COUNT(r.id) AS review_count
    FROM operators o
    LEFT JOIN reviews r ON r.operator_id = o.id AND r.is_published = true
    WHERE 1=1
  `;
	const opParams: any[] = [];
	let opParamCount = 1;

	if (category) {
		opQuery += ` AND o.category = $${opParamCount}`;
		opParams.push(category);
		opParamCount++;
	}
	if (region) {
		opQuery += ` AND o.region ILIKE $${opParamCount}`;
		opParams.push(`%${region}%`);
		opParamCount++;
	}
	opQuery += ` GROUP BY o.id LIMIT 100`;

	// Fetch places from cache
	let placeQuery = `
    SELECT pc.id, 'place' AS type, pc.name, pc.category,
           pc.description, pc.region, pc.address,
           pc.latitude, pc.longitude,
           pc.website, pc.phone, pc.tags, pc.price_level, pc.photos,
           pc.is_claimed, false AS is_verified,
           pc.rating, pc.review_count
    FROM places_cache pc
    WHERE pc.expires_at > NOW()
  AND pc.source = 'google_places_v2'
  `;
	const placeParams: any[] = [];
	let placeParamCount = 1;

	if (category) {
		placeQuery += ` AND pc.category = $${placeParamCount}`;
		placeParams.push(category);
		placeParamCount++;
	}
	if (region) {
		placeQuery += ` AND pc.region ILIKE $${placeParamCount}`;
		placeParams.push(`%${region}%`);
		placeParamCount++;
	}
	placeQuery += ` ORDER BY pc.is_claimed DESC, pc.rating DESC LIMIT 100`;

	const [opResult, placeResult] = await Promise.all([
		pool.query(opQuery, opParams),
		pool.query(placeQuery, placeParams),
	]);

	const allItems = [...opResult.rows, ...placeResult.rows];

	// Get member preferences if authenticated
	const prefs = userId ? await getMemberPreferences(userId) : null;

	let scored: RecommendationResult[];

	if (prefs && prefs.onboarding_completed) {
		// Full personalized scoring
		scored = allItems
			.map((item) => {
				const breakdown = scoreOperator(item, prefs, region);
				const score = totalScore(breakdown);
				return {
					id: item.id,
					type: item.type,
					name: item.name,
					category: item.category,
					description: item.description,
					region: item.region,
					address: item.address,
					latitude: item.latitude ? parseFloat(item.latitude) : null,
					longitude: item.longitude ? parseFloat(item.longitude) : null,
					rating: item.rating ? parseFloat(item.rating) : null,
					review_count: parseInt(item.review_count) || 0,
					price_level: item.price_level,
					photos: Array.isArray(item.photos)
						? item.photos
						: item.photos
							? JSON.parse(item.photos)
							: [],
					tags: item.tags || [],
					is_claimed: item.is_claimed || false,
					is_verified: item.is_verified || false,
					score,
					score_breakdown: breakdown,
					website: item.website,
					phone: item.phone,
				};
			})
			.sort((a, b) => b.score - a.score);
	} else if (prefs) {
		// Partial preferences - use what we have, rest by rating
		scored = allItems
			.map((item) => {
				const breakdown = scoreOperator(item, prefs, region);
				const score = totalScore(breakdown);
				return {
					id: item.id,
					type: item.type as "operator" | "place",
					name: item.name,
					category: item.category,
					description: item.description,
					region: item.region,
					address: item.address,
					latitude: item.latitude ? parseFloat(item.latitude) : null,
					longitude: item.longitude ? parseFloat(item.longitude) : null,
					rating: item.rating ? parseFloat(item.rating) : null,
					review_count: parseInt(item.review_count) || 0,
					price_level: item.price_level,
					photos: Array.isArray(item.photos)
						? item.photos
						: item.photos
							? JSON.parse(item.photos)
							: [],
					tags: item.tags || [],
					is_claimed: item.is_claimed || false,
					is_verified: item.is_verified || false,
					score,
					score_breakdown: breakdown,
					website: item.website,
					phone: item.phone,
				};
			})
			.sort((a, b) => b.score - a.score);
	} else {
		// Anonymous - rank by claimed status then rating
		scored = allItems
			.map((item) => ({
				id: item.id,
				type: item.type as "operator" | "place",
				name: item.name,
				category: item.category,
				description: item.description,
				region: item.region,
				address: item.address,
				latitude: item.latitude ? parseFloat(item.latitude) : null,
				longitude: item.longitude ? parseFloat(item.longitude) : null,
				rating: item.rating ? parseFloat(item.rating) : null,
				review_count: parseInt(item.review_count) || 0,
				price_level: item.price_level,
				photos: Array.isArray(item.photos)
					? item.photos
					: item.photos
						? JSON.parse(item.photos)
						: [],
				tags: item.tags || [],
				is_claimed: item.is_claimed || false,
				is_verified: item.is_verified || false,
				score: (item.is_claimed ? 10 : 0) + (parseFloat(item.rating) || 0) * 2,
				score_breakdown: {
					activity: 0,
					budget: 0,
					region: 0,
					dietary: 0,
					accommodation: 0,
					rating_boost: 0,
					claimed_bonus: 0,
				},
				website: item.website,
				phone: item.phone,
			}))
			.sort((a, b) => b.score - a.score);
	}

	const results = scored.slice(0, limit);

	// Cache results for 1 hour for authenticated users
	if (userId) {
		const cacheKey = `rec:${userId}:${category || "all"}:${region || "all"}`;
		await redis.setex(cacheKey, 3600, JSON.stringify(results));
	}

	return results;
}

// Track member interaction for future recommendation improvement
export async function trackInteraction(
	userId: string,
	entityType: "operator" | "place",
	entityId: string,
	interactionType: "view" | "save" | "book" | "review" | "share",
	metadata: { region?: string; category?: string; tags?: string[] } = {},
): Promise<void> {
	try {
		await pool.query(
			`INSERT INTO member_interactions
         (id, user_id, entity_type, entity_id, interaction_type, region, category, tags)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
			[
				userId,
				entityType,
				entityId,
				interactionType,
				metadata.region || null,
				metadata.category || null,
				metadata.tags || [],
			],
		);

		// Invalidate recommendation cache when user interacts
		const cachePattern = `rec:${userId}:*`;
		const keys = await redis.keys(cachePattern);
		if (keys.length > 0) {
			await redis.del(...keys);
		}
	} catch (err) {
		console.error("Failed to track interaction:", err);
	}
}

// Save / unsave an operator or place
export async function toggleSave(
	userId: string,
	entityType: "operator" | "place",
	entityId: string,
): Promise<{ saved: boolean }> {
	const existing = await pool.query(
		"SELECT id FROM member_saves WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3",
		[userId, entityType, entityId],
	);

	if (existing.rows.length > 0) {
		await pool.query(
			"DELETE FROM member_saves WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3",
			[userId, entityType, entityId],
		);
		return { saved: false };
	} else {
		await pool.query(
			`INSERT INTO member_saves (id, user_id, entity_type, entity_id)
       VALUES (gen_random_uuid(), $1, $2, $3)`,
			[userId, entityType, entityId],
		);
		await trackInteraction(userId, entityType, entityId, "save");
		return { saved: true };
	}
}
