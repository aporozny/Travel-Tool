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
	// v2: name resolution order changed (sublocalities like Canggu no longer
	// broaden to their admin area) — new prefix invalidates old cached names
	const key = `geo:v3:${destination.toLowerCase().trim()}`;

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
		// Smallest-area name first: "Canggu" must stay Canggu, not broaden to
		// a district or admin area (which would then match nothing in the
		// catalog). Admin levels are deliberately excluded — the fallback is
		// the first formatted-address segment, which names what was searched.
		const NAME_TYPES = [
			"locality",
			"sublocality",
			"sublocality_level_1",
			"neighborhood",
		];
		let localityComp: any = null;
		for (const t of NAME_TYPES) {
			localityComp = (r.address_components || []).find((c: any) =>
				c.types.includes(t),
			);
			if (localityComp) break;
		}

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

export interface ReverseCountryResult {
	countryCode: string; // ISO 3166-1 alpha-2, e.g. "ID"
	countryName: string; // e.g. "Indonesia"
}

/**
 * Reverse-geocode a lat/lng to a country, for feeding the Safety Line a
 * last-known location without asking the caller. Same Google Geocoding
 * endpoint as geocodeDestination, just latlng= instead of address= — no
 * new API key needed. Cached in Redis at 2-decimal precision (~1km grid,
 * plenty for "which country") so nearby pings share a cache entry.
 * Returns null on failure — callers must fall back to asking, never
 * guess a country with confidence they don't have.
 */
export async function reverseGeocodeCountry(
	lat: number,
	lng: number,
): Promise<ReverseCountryResult | null> {
	const key = `geo:rev:v1:${lat.toFixed(2)},${lng.toFixed(2)}`;

	try {
		const cached = await redis.get(key);
		if (cached) return JSON.parse(cached);
	} catch {
		// Redis down — proceed to API
	}

	if (!GOOGLE_API_KEY) return null;

	try {
		const { data } = await axios.get(
			"https://maps.googleapis.com/maps/api/geocode/json",
			{ params: { latlng: `${lat},${lng}`, key: GOOGLE_API_KEY, language: "en" } },
		);
		if (data.status !== "OK" || !data.results?.length) return null;

		const countryComp = data.results
			.flatMap((r: any) => r.address_components || [])
			.find((c: any) => c.types.includes("country"));
		if (!countryComp) return null;

		const result: ReverseCountryResult = {
			countryCode: countryComp.short_name,
			countryName: countryComp.long_name,
		};

		try {
			await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(result));
		} catch {
			// cache write failure is non-fatal
		}
		return result;
	} catch (err) {
		console.error(
			"Reverse geocoding failed for",
			lat,
			lng,
			err instanceof Error ? err.message : err,
		);
		return null;
	}
}
