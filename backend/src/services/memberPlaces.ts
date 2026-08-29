import { pool } from "../utils/db";
import { sameVenue } from "./dedup";

const NEW_PLACE_DAILY_LIMIT = 5;
// places_cache's usual expires_at is a decaying-cache signal for API-fetched
// rows (30-365 days). A member-submitted row isn't a cache of anything --
// it's a real place someone actually visited -- so it gets a long horizon
// instead of the short refetch-driven ones, while still being finite so an
// abandoned/wrong entry doesn't sit forever.
const MEMBER_PLACE_EXPIRY_INTERVAL = "3 years";
// Candidate search radius before running the exact sameVenue() fuzzy match --
// wide enough to catch the real dedup.ts PROXIMITY_METERS (150m) match plus
// some slack, narrow enough to keep the candidate set small per region.
const CANDIDATE_RADIUS_METERS = 500;

export interface NewPlaceInput {
	name: string;
	lat: number;
	lng: number;
	region: string;
	country?: string;
	category: "food" | "accommodation" | "activity" | "transport";
	submittedBy: string;
}

export class DailyPlaceLimitError extends Error {
	constructor() {
		super(`You can add up to ${NEW_PLACE_DAILY_LIMIT} new places per day. Try again tomorrow, or tag an existing place instead.`);
	}
}

// Resolve a member's "I went here" place to an existing places_cache row
// when it's the same real-world venue (reuses the exact fuzzy match already
// proven for cross-source Google/Foursquare dedup), or create a new
// source='member' row when it's genuinely new. Either way, every distinct
// author who resolves to the same row is the corroboration signal --
// visible via COUNT(DISTINCT community_posts.author_id) at read time, not a
// counter maintained here.
export async function resolveOrCreatePlace(input: NewPlaceInput): Promise<string> {
	const latDelta = CANDIDATE_RADIUS_METERS / 111_000;
	const lngDelta =
		CANDIDATE_RADIUS_METERS / (111_000 * Math.max(0.2, Math.cos((input.lat * Math.PI) / 180)));

	const { rows: candidates } = await pool.query(
		`SELECT id, name, latitude, longitude
		 FROM places_cache
		 WHERE region ILIKE $1
		   AND latitude BETWEEN $2 AND $3
		   AND longitude BETWEEN $4 AND $5`,
		[
			`%${input.region}%`,
			input.lat - latDelta,
			input.lat + latDelta,
			input.lng - lngDelta,
			input.lng + lngDelta,
		],
	);

	const match = candidates.find((c) =>
		sameVenue({ name: input.name, latitude: input.lat, longitude: input.lng }, c),
	);
	if (match) return match.id;

	const { rows: recentCount } = await pool.query(
		`SELECT COUNT(*) AS c FROM places_cache
		 WHERE submitted_by = $1 AND created_at > NOW() - INTERVAL '1 day'`,
		[input.submittedBy],
	);
	if (parseInt(recentCount[0].c, 10) >= NEW_PLACE_DAILY_LIMIT) {
		throw new DailyPlaceLimitError();
	}

	const { rows: inserted } = await pool.query(
		`INSERT INTO places_cache
		   (id, external_id, source, name, category, region, country, latitude, longitude,
		    submitted_by, expires_at)
		 VALUES
		   (gen_random_uuid(), 'member:' || gen_random_uuid()::text, 'member', $1, $2, $3, $4, $5, $6,
		    $7, NOW() + INTERVAL '${MEMBER_PLACE_EXPIRY_INTERVAL}')
		 RETURNING id`,
		[input.name, input.category, input.region, input.country ?? null, input.lat, input.lng, input.submittedBy],
	);
	return inserted[0].id;
}
