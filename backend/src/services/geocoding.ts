import axios from "axios";
import { redis } from "../utils/redis";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const CACHE_TTL_SECONDS = 90 * 24 * 3600; // 90 days — city coordinates don't move

export interface GeoResult {
	name: string; // canonical name, e.g. "Lisbon"
	country: string; // e.g. "Portugal"
	latitude: number;
	longitude: number;
	// Viewport radius in metres, for Places location bias. Clamped 5–50km.
	radiusMeters: number;
}

function viewportRadius(geometry: any): number {
	const vp = geometry?.viewport;
	if (!vp?.northeast || !vp?.southwest) return 15000;
	const dLat = Math.abs(vp.northeast.lat - vp.southwest.lat);
	const metres = (dLat / 2) * 111_000;
	return Math.max(5000, Math.min(50000, Math.round(metres)));
}

/**
 * Resolve a free-text destination to coordinates via Google Geocoding,
 * cached in Redis. Returns null on failure — callers must degrade to
 * region-string matching, never throw to the user.
 */
export async function geocodeDestination(
	destination: string,
): Promise<GeoResult | null> {
	const key = `geo:${destination.toLowerCase().trim()}`;

	try {
		const cached = await redis.get(key);
		if (cached) return JSON.parse(cached);
	} catch {
		// Redis down — proceed to API
	}

	if (!GOOGLE_API_KEY || !destination.trim()) return null;

	try {
		const { data } = await axios.get(
			"https://maps.googleapis.com/maps/api/geocode/json",
			{ params: { address: destination, key: GOOGLE_API_KEY, language: "en" } },
		);
		if (data.status !== "OK" || !data.results?.length) return null;

		const r = data.results[0];
		const countryComp = (r.address_components || []).find((c: any) =>
			c.types.includes("country"),
		);
		const localityComp = (r.address_components || []).find(
			(c: any) =>
				c.types.includes("locality") ||
				c.types.includes("administrative_area_level_1"),
		);

		const result: GeoResult = {
			name: localityComp?.long_name || r.formatted_address.split(",")[0],
			country: countryComp?.long_name || "",
			latitude: r.geometry.location.lat,
			longitude: r.geometry.location.lng,
			radiusMeters: viewportRadius(r.geometry),
		};

		try {
			await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(result));
		} catch {
			// cache write failure is non-fatal
		}
		return result;
	} catch (err) {
		console.error(
			"Geocoding failed for",
			destination,
			err instanceof Error ? err.message : err,
		);
		return null;
	}
}
