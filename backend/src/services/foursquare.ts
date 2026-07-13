import axios from "axios";
import { PlaceResult } from "./googlePlaces";
import { GeoResult } from "./geocoding";

const FOURSQUARE_API_KEY = process.env.FOURSQUARE_API_KEY;

export function foursquareEnabled(): boolean {
	return Boolean(FOURSQUARE_API_KEY);
}

// Foursquare category groups -> Drift categories
export function mapFsqCategory(categories: any[]): string {
	const ids = categories.map((c) => c.id as number);
	// 4d4b7105d754a06374d81259 food root; v3 integer IDs: 13000-13999 food & dining
	if (ids.some((id) => id >= 13000 && id < 14000)) return "food";
	// 19009-19030 lodging
	if (ids.some((id) => id >= 19009 && id <= 19030)) return "accommodation";
	return "activity";
}

// Foursquare Places v3 search near a geocoded destination. Second opinion
// alongside Google; env-gated, absent key = clean no-op.
export async function searchFoursquare(
	query: string,
	destinationName: string,
	geo: GeoResult,
	limit = 20,
): Promise<PlaceResult[]> {
	if (!foursquareEnabled()) return [];

	try {
		const { data } = await axios.get(
			"https://api.foursquare.com/v3/places/search",
			{
				headers: {
					Authorization: FOURSQUARE_API_KEY!,
					Accept: "application/json",
				},
				params: {
					query,
					ll: `${geo.latitude},${geo.longitude}`,
					radius: Math.min(geo.radiusMeters, 100000),
					limit: Math.min(limit, 50),
					fields:
						"fsq_id,name,categories,location,geocodes,rating,stats,price,website,tel,photos",
				},
			},
		);

		return (data.results || []).map(
			(p: any): PlaceResult => ({
				external_id: p.fsq_id,
				source: "foursquare",
				name: p.name,
				category: mapFsqCategory(p.categories || []),
				description: null,
				address: p.location?.formatted_address || null,
				region: destinationName,
				country: geo.country,
				latitude: p.geocodes?.main?.latitude ?? null,
				longitude: p.geocodes?.main?.longitude ?? null,
				phone: p.tel || null,
				website: p.website || null,
				// Foursquare ratings are 0-10; normalise to 0-5
				rating: p.rating ? Math.round((p.rating / 2) * 10) / 10 : null,
				review_count: p.stats?.total_ratings || 0,
				price_level: p.price || null,
				photos: (p.photos || [])
					.slice(0, 3)
					.map((ph: any) => `${ph.prefix}original${ph.suffix}`),
				opening_hours: null,
				tags: (p.categories || []).map((c: any) =>
					String(c.name || "")
						.toLowerCase()
						.replace(/\s+/g, "_"),
				),
				raw_data: { fsq_id: p.fsq_id },
			}),
		);
	} catch (err: any) {
		console.error(
			"Foursquare search failed:",
			err?.response?.status || err?.message,
		);
		return [];
	}
}
