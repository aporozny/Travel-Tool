import { redis } from "./redis";

// Redis GEO presence layer for Trip Mode. This is the answer to "how do
// we track many people at once": every user's ping is an independent
// GEOADD, and a GEOSEARCH radius query against the whole set is a single
// indexed lookup regardless of whether there are 20 or 20,000 live
// travelers -- concurrency isn't a special problem once this is the data
// structure, it's just normal Redis usage.
//
// Redis GEO members have no per-member TTL, so the existing
// location:{userId} SETEX cache (already written by POST /safety/location
// before this file existed) is kept as the real freshness source of
// truth -- findNearby() cross-checks it and self-heals (ZREM) any geoset
// member whose cache already expired, rather than ever trusting a stale
// geoset entry.

const PRESENCE_KEY = "presence:live";
const LOCATION_TTL_SECONDS = 60 * 60 * 24; // 24h, matches the pre-existing location:{userId} cache

// Trip Mode's client-side throttle. Kept as named constants so tuning
// this later is a one-line change, not a redesign.
export const TRIP_MODE_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const TRIP_MODE_UPDATE_DISTANCE_M = 250; // or 250m moved, whichever first

export interface NearbyMember {
	userId: string;
	distanceKm: number;
	recordedAt: string;
}

export async function upsertPresence(
	userId: string,
	lat: number,
	lng: number,
	recordedAt: string,
): Promise<void> {
	const pipeline = redis.pipeline();
	pipeline.geoadd(PRESENCE_KEY, lng, lat, userId);
	pipeline.setex(
		`location:${userId}`,
		LOCATION_TTL_SECONDS,
		JSON.stringify({ latitude: lat, longitude: lng, recorded_at: recordedAt }),
	);
	await pipeline.exec();
}

// Called immediately when Trip Mode is turned off, so opt-out doesn't
// wait on the cache's 24h TTL.
export async function removePresence(userId: string): Promise<void> {
	await Promise.all([redis.zrem(PRESENCE_KEY, userId), redis.del(`location:${userId}`)]);
}

export async function findNearby(
	lat: number,
	lng: number,
	radiusKm: number,
	excludeUserId: string,
	limit: number,
): Promise<NearbyMember[]> {
	const raw = (await redis.geosearch(
		PRESENCE_KEY,
		"FROMLONLAT",
		lng,
		lat,
		"BYRADIUS",
		radiusKm,
		"km",
		"ASC",
		"COUNT",
		limit + 1, // +1 in case the requester's own point is in range
		"WITHDIST",
	)) as [string, string][];

	const candidates = raw.filter(([userId]) => userId !== excludeUserId).slice(0, limit);
	if (candidates.length === 0) return [];

	const keys = candidates.map(([userId]) => `location:${userId}`);
	const cached = await redis.mget(...keys);

	const results: NearbyMember[] = [];
	const stale: string[] = [];
	candidates.forEach(([userId, distanceStr], i) => {
		const cachedValue = cached[i];
		if (!cachedValue) {
			stale.push(userId);
			return;
		}
		const parsed = JSON.parse(cachedValue);
		// Rounded to the nearest whole km -- no sub-km precision surfaced to
		// another member, since "anyone with Trip Mode on" (not just people
		// on a shared declared trip) can appear in these results.
		results.push({
			userId,
			distanceKm: Math.round(parseFloat(distanceStr)),
			recordedAt: parsed.recorded_at,
		});
	});

	if (stale.length > 0) {
		redis
			.zrem(PRESENCE_KEY, ...stale)
			.catch((err) => console.error("geoPresence: failed to clean up stale presence entries", err));
	}

	return results;
}
