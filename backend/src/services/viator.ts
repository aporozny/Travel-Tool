import axios from "axios";
import { redis } from "../utils/redis";
import { PlaceResult } from "./googlePlaces";

const VIATOR_API_KEY = process.env.VIATOR_API_KEY;
const BASE = process.env.VIATOR_API_BASE || "https://api.viator.com/partner";
const DEST_CACHE_KEY = "viator:destinations";
const DEST_CACHE_TTL = 7 * 24 * 3600; // destination taxonomy changes rarely

export function viatorEnabled(): boolean {
	return Boolean(VIATOR_API_KEY);
}

function headers() {
	return {
		"exp-api-key": VIATOR_API_KEY!,
		Accept: "application/json;version=2.0",
		"Accept-Language": "en-US",
		"Content-Type": "application/json",
	};
}

interface ViatorDestination {
	destinationId: number;
	name: string;
	type: string;
}

// Full destination taxonomy, cached 7 days (thousands of rows, one call).
async function getDestinations(): Promise<ViatorDestination[]> {
	try {
		const cached = await redis.get(DEST_CACHE_KEY);
		if (cached) return JSON.parse(cached);
	} catch {
		/* redis down — fetch live */
	}

	const { data } = await axios.get(`${BASE}/destinations`, {
		headers: headers(),
	});
	const dests: ViatorDestination[] = (data.destinations || []).map(
		(d: any) => ({
			destinationId: d.destinationId,
			name: d.name,
			type: d.type,
		}),
	);

	try {
		await redis.setex(DEST_CACHE_KEY, DEST_CACHE_TTL, JSON.stringify(dests));
	} catch {
		/* non-fatal */
	}
	return dests;
}

// Match a free-text destination to a Viator destination ID. Exact
// case-insensitive name match preferred; CITY-type wins over broader types.
export function matchDestination(
	destinations: ViatorDestination[],
	name: string,
): ViatorDestination | null {
	const needle = name.toLowerCase().trim();
	const matches = destinations.filter((d) => d.name.toLowerCase() === needle);
	if (matches.length === 0) return null;
	const city = matches.find((d) => d.type === "CITY");
	return city || matches[0];
}

// Search bookable tours/experiences for a destination. Returns PlaceResult
// rows (source='viator') ready for places_cache upsert; the affiliate
// productUrl goes in `website` — that link is the commission hook.
export async function searchViatorProducts(
	destinationName: string,
	country: string,
	limit = 20,
): Promise<PlaceResult[]> {
	if (!viatorEnabled()) return [];

	try {
		const destinations = await getDestinations();
		const dest = matchDestination(destinations, destinationName);
		if (!dest) return [];

		const { data } = await axios.post(
			`${BASE}/products/search`,
			{
				filtering: { destination: String(dest.destinationId) },
				sorting: { sort: "TRAVELER_RATING", order: "DESCENDING" },
				pagination: { start: 1, count: Math.min(limit, 50) },
				currency: "AUD",
			},
			{ headers: headers() },
		);

		return (data.products || []).map(
			(p: any): PlaceResult => ({
				external_id: p.productCode,
				source: "viator",
				name: p.title,
				category: "activity",
				description: p.description?.slice(0, 500) || null,
				address: null,
				region: destinationName,
				country,
				latitude: null,
				longitude: null,
				phone: null,
				website: p.productUrl || null, // affiliate link — revenue hook
				rating: p.reviews?.combinedAverageRating || null,
				review_count: p.reviews?.totalReviews || 0,
				price_level: null,
				photos: (p.images || [])
					.slice(0, 3)
					.map(
						(img: any) =>
							img.variants?.find((v: any) => v.width >= 400)?.url ||
							img.variants?.[0]?.url,
					)
					.filter(Boolean),
				opening_hours: null,
				tags: ["tour", "bookable", ...(p.tags || []).slice(0, 5).map(String)],
				raw_data: {
					productCode: p.productCode,
					fromPrice: p.pricing?.summary?.fromPrice,
					currency: p.pricing?.currency,
					duration: p.duration,
				},
			}),
		);
	} catch (err: any) {
		console.error(
			"Viator search failed:",
			err?.response?.status || err?.message,
		);
		return []; // tours are additive — never break core search
	}
}
