import axios from "axios";
import { redis } from "../utils/redis";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const CACHE_TTL_SECONDS = 90 * 24 * 3600; // 90 days — neighborhoods don't move

// Grid-snap to ~110m so nearby cluster centroids share one cached lookup
// instead of each paying for their own reverse-geocode call.
const GRID_DECIMALS = 3;

function gridKey(lat: number, lng: number): string {
	return `${lat.toFixed(GRID_DECIMALS)},${lng.toFixed(GRID_DECIMALS)}`;
}

const NEIGHBORHOOD_TYPES = [
	"neighborhood",
	"sublocality",
	"sublocality_level_1",
];

async function reverseGeocodeGoogle(
	lat: number,
	lng: number,
): Promise<string | null> {
	if (!GOOGLE_API_KEY) return null;
	try {
		const { data } = await axios.get(
			"https://maps.googleapis.com/maps/api/geocode/json",
			{
				params: {
					latlng: `${lat},${lng}`,
					result_type: "neighborhood|sublocality",
					key: GOOGLE_API_KEY,
					language: "en",
				},
			},
		);
		if (data.status !== "OK" || !data.results?.length) return null;
		for (const r of data.results) {
			for (const t of NEIGHBORHOOD_TYPES) {
				const comp = (r.address_components || []).find((c: any) =>
					c.types.includes(t),
				);
				if (comp?.long_name) return comp.long_name;
			}
		}
		return null;
	} catch (err) {
		console.error(
			"Google reverse-geocode failed:",
			err instanceof Error ? err.message : err,
		);
		return null;
	}
}

// Public Nominatim instance — genuine second source, independent of
// Google. Usage policy: max ~1 req/s, descriptive User-Agent required, no
// heavy bulk use. This is called only as a last-resort fallback (token
// harvest and Google Geocoding both already failed), so real volume is
// low and well within policy — this must stay that way, never become a
// primary/bulk path without self-hosting Nominatim first.
async function reverseGeocodeOSM(
	lat: number,
	lng: number,
): Promise<string | null> {
	try {
		const { data } = await axios.get(
			"https://nominatim.openstreetmap.org/reverse",
			{
				params: { lat, lon: lng, format: "jsonv2", zoom: 16 },
				headers: { "User-Agent": "DriftTravelApp/1.0 (https://drifttravel.app)" },
				timeout: 5000,
			},
		);
		const addr = data?.address;
		if (!addr) return null;
		return (
			addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || null
		);
	} catch (err) {
		console.error(
			"OSM reverse-geocode failed:",
			err instanceof Error ? err.message : err,
		);
		return null;
	}
}

// Layered fallback: Google Geocoding first (same account already paid
// for, proven reliable — verified live against Singapore data returning
// "Bishan" where Places' own addressComponents gave nothing usable), then
// OpenStreetMap/Nominatim as a genuine independent second source for
// whatever Google's Geocoding also misses. Cached by grid-snapped
// coordinate so repeated cron runs over the same area don't re-pay for
// the same lookup. Never called live/per-search — batch job only.
export async function reverseGeocodeNeighborhoodName(
	lat: number,
	lng: number,
): Promise<string | null> {
	const key = `neighborhood:v1:${gridKey(lat, lng)}`;

	try {
		const cached = await redis.get(key);
		if (cached !== null) return cached === "" ? null : cached;
	} catch {
		// Redis down — proceed to live lookup
	}

	const name = (await reverseGeocodeGoogle(lat, lng)) || (await reverseGeocodeOSM(lat, lng));

	try {
		await redis.setex(key, CACHE_TTL_SECONDS, name || "");
	} catch {
		// cache write failure is non-fatal
	}

	return name;
}
