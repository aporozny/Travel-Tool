import axios from "axios";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

const TYPE_MAP: Record<string, string> = {
	restaurant: "food",
	food: "food",
	cafe: "food",
	bar: "food",
	meal_takeaway: "food",
	bakery: "food",
	lodging: "accommodation",
	hotel: "accommodation",
	tourist_attraction: "activity",
	amusement_park: "activity",
	aquarium: "activity",
	museum: "activity",
	park: "activity",
	spa: "activity",
	gym: "activity",
	travel_agency: "activity",
	car_rental: "transport",
	taxi_stand: "transport",
};

function mapCategory(types: string[]): string {
	for (const t of types) {
		if (TYPE_MAP[t]) return TYPE_MAP[t];
	}
	return "activity";
}

export interface PlaceResult {
	external_id: string;
	source: "google";
	name: string;
	category: string;
	description: string | null;
	address: string | null;
	region: string;
	country: string;
	latitude: number | null;
	longitude: number | null;
	phone: string | null;
	website: string | null;
	rating: number | null;
	review_count: number;
	price_level: number | null;
	photos: string[]; // photo references only, not full URLs
	opening_hours: any;
	tags: string[];
	raw_data: any;
}

export interface SearchGeo {
	latitude: number;
	longitude: number;
	radiusMeters: number;
	country: string;
}

// Places API v1 PriceLevel enum -> numeric 1-4
export function mapPriceLevelV1(level?: string): number | null {
	switch (level) {
		case "PRICE_LEVEL_FREE":
		case "PRICE_LEVEL_INEXPENSIVE":
			return 1;
		case "PRICE_LEVEL_MODERATE":
			return 2;
		case "PRICE_LEVEL_EXPENSIVE":
			return 3;
		case "PRICE_LEVEL_VERY_EXPENSIVE":
			return 4;
		default:
			return null;
	}
}

const V1_FIELD_MASK = [
	"places.id",
	"places.displayName",
	"places.formattedAddress",
	"places.location",
	"places.rating",
	"places.userRatingCount",
	"places.priceLevel",
	"places.types",
	"places.photos.name",
	"places.websiteUri",
	"places.nationalPhoneNumber",
	"places.editorialSummary",
].join(",");

// Places API v1 searchText: one call returns details that previously needed
// a second Place Details request (phone, website, summary).
async function searchPlacesV1(
	query: string,
	region: string,
	geo?: SearchGeo | null,
): Promise<PlaceResult[]> {
	const body: any = {
		textQuery: geo ? query : `${query} ${region}`,
		languageCode: "en",
		maxResultCount: 20,
	};
	if (geo) {
		body.locationBias = {
			circle: {
				center: { latitude: geo.latitude, longitude: geo.longitude },
				radius: Math.min(geo.radiusMeters, 50000),
			},
		};
	}

	const { data } = await axios.post(
		"https://places.googleapis.com/v1/places:searchText",
		body,
		{
			headers: {
				"X-Goog-Api-Key": GOOGLE_API_KEY!,
				"X-Goog-FieldMask": V1_FIELD_MASK,
				"Content-Type": "application/json",
			},
		},
	);

	return (data.places || []).map(
		(place: any): PlaceResult => ({
			external_id: place.id,
			source: "google",
			name: place.displayName?.text || "",
			category: mapCategory(place.types || []),
			description: place.editorialSummary?.text || null,
			address: place.formattedAddress || null,
			region,
			country: geo?.country || "",
			latitude: place.location?.latitude ?? null,
			longitude: place.location?.longitude ?? null,
			phone: place.nationalPhoneNumber || null,
			website: place.websiteUri || null,
			rating: place.rating || null,
			review_count: place.userRatingCount || 0,
			price_level: mapPriceLevelV1(place.priceLevel),
			// v1 photo resource names ("places/{id}/photos/{id}") — already
			// supported by fetchPhotoBuffer
			photos: (place.photos || []).slice(0, 5).map((p: any) => p.name),
			opening_hours: null,
			tags: (place.types || []).filter(
				(t: string) => !["point_of_interest", "establishment"].includes(t),
			),
			raw_data: { place_id: place.id, types: place.types },
		}),
	);
}

export async function searchPlaces(
	query: string,
	region: string,
	geo?: SearchGeo | null,
): Promise<PlaceResult[]> {
	if (!GOOGLE_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY not set");

	// Prefer Places API v1 (richer data, one call); fall back to legacy
	// textsearch when v1 is not enabled on this key.
	try {
		return await searchPlacesV1(query, region, geo);
	} catch (err: any) {
		const status = err?.response?.status;
		console.warn(
			`Places v1 unavailable (${status || err?.message}); falling back to legacy textsearch`,
		);
	}

	const params: Record<string, string> = {
		query: geo ? query : `${query} ${region}`,
		key: GOOGLE_API_KEY,
		language: "en",
	};
	if (geo) {
		params.location = `${geo.latitude},${geo.longitude}`;
		params.radius = String(geo.radiusMeters);
	}

	const { data } = await axios.get(
		"https://maps.googleapis.com/maps/api/place/textsearch/json",
		{ params },
	);

	if (data.status === "ZERO_RESULTS") return [];
	if (data.status !== "OK") {
		throw new Error(
			`Google Places API error: ${data.status} - ${data.error_message || ""}`,
		);
	}

	return (data.results || []).map(
		(place: any): PlaceResult => ({
			external_id: place.place_id,
			source: "google",
			name: place.name,
			category: mapCategory(place.types || []),
			description: null,
			address: place.formatted_address || null,
			region,
			country: geo?.country || "",
			latitude: place.geometry?.location?.lat || null,
			longitude: place.geometry?.location?.lng || null,
			phone: null,
			website: null,
			rating: place.rating || null,
			review_count: place.user_ratings_total || 0,
			price_level: place.price_level || null,
			// Store only photo references, not full URLs with API key
			photos: (place.photos || [])
				.slice(0, 5)
				.map((p: any) => p.photo_reference),
			opening_hours: place.opening_hours || null,
			tags: (place.types || []).filter(
				(t: string) => !["point_of_interest", "establishment"].includes(t),
			),
			raw_data: {
				place_id: place.place_id,
				types: place.types,
				name: place.name,
			}, // stripped raw_data - no need to store full response
		}),
	);
}

export async function getPlaceDetails(
	placeId: string,
): Promise<Partial<PlaceResult>> {
	if (!GOOGLE_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY not set");

	const { data } = await axios.get(
		"https://maps.googleapis.com/maps/api/place/details/json",
		{
			params: {
				place_id: placeId,
				fields:
					"formatted_phone_number,website,opening_hours,editorial_summary,address_components",
				key: GOOGLE_API_KEY,
				language: "en",
			},
		},
	);

	if (data.status !== "OK")
		throw new Error(`Google Place Details error: ${data.status}`);

	const r = data.result;
	const sublocality = (r.address_components || []).find(
		(c: any) => c.types.includes("sublocality") || c.types.includes("locality"),
	);

	return {
		phone: r.formatted_phone_number || null,
		website: r.website || null,
		description: r.editorial_summary?.overview || null,
		opening_hours: r.opening_hours || null,
		region: sublocality?.long_name || null,
	};
}

// Proxy: fetch photo from Google using reference, return buffer
export async function fetchPhotoBuffer(
	photoReference: string,
	maxWidth = 800,
): Promise<{ data: Buffer; contentType: string }> {
	if (!GOOGLE_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY not set");

	// New Places API v1 format: "places/{place_id}/photos/{photo_id}"
	if (photoReference.startsWith("places/")) {
		const url = `https://places.googleapis.com/v1/${photoReference}/media`;
		const response = await axios.get(url, {
			params: { maxWidthPx: maxWidth, key: GOOGLE_API_KEY },
			responseType: "arraybuffer",
			maxRedirects: 5,
		});
		return {
			data: Buffer.from(response.data),
			contentType: response.headers["content-type"] || "image/jpeg",
		};
	}

	// Legacy format
	const response = await axios.get(
		"https://maps.googleapis.com/maps/api/place/photo",
		{
			params: {
				maxwidth: maxWidth,
				photo_reference: photoReference,
				key: GOOGLE_API_KEY,
			},
			responseType: "arraybuffer",
			maxRedirects: 5,
		},
	);
	return {
		data: Buffer.from(response.data),
		contentType: response.headers["content-type"] || "image/jpeg",
	};
}
