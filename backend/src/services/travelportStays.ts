import { travelportPost } from "../utils/travelportClient";
import { geocodeDestination } from "./geocoding";
import type { StaysSearchParams, StaysAccommodationView } from "./stays";

// Travelport Hotel search, alongside Duffel -- not a replacement. Reuses
// the same geocodeDestination() Duffel's own stays.ts already calls, so
// both providers search the same free-text destination consistently.
//
// Confirmed live 2026-09-08: real sandbox properties near Denver came
// back with NO rate data at all ("Rates unavailable for N properties" --
// a real API warning, not a mapping gap) and no photos. cheapestRateTotal
// Amount/Currency and photoUrls are handled as genuinely absent rather
// than assumed present, unlike Duffel where they always are.

interface TravelportRating {
	value: number;
	provider?: string;
}

interface TravelportProperty {
	id: string;
	name: string;
	Rating?: TravelportRating[];
	GeoLocation?: { latitude: number; longitude: number };
	Address?: { City?: string; Country?: { value: string } };
	PropertyAmenity?: { description: string }[];
}

interface TravelportPropertyInfo {
	id: string;
	availability: string;
	Property: TravelportProperty;
	LowestAvailableRate?: { value: number; code: string };
}

interface PropertiesSearchResponse {
	PropertiesResponse: {
		Properties?: { PropertyInfo?: TravelportPropertyInfo[] };
	};
}

function toAccommodationView(info: TravelportPropertyInfo): StaysAccommodationView {
	const prop = info.Property;
	return {
		id: info.id,
		accommodationId: prop.id,
		name: prop.name,
		cityName: prop.Address?.City ?? "",
		countryCode: prop.Address?.Country?.value ?? "",
		rating: prop.Rating?.[0]?.value ?? null,
		reviewScore: null, // not returned by this endpoint in any observed response
		reviewCount: null,
		photoUrls: [], // observed absent ("Images unavailable") -- not assumed present
		amenityTypes: (prop.PropertyAmenity ?? []).map((a) => a.description),
		cheapestRateTotalAmount: info.LowestAvailableRate ? String(info.LowestAvailableRate.value) : null,
		cheapestRateCurrency: info.LowestAvailableRate?.code ?? null,
		latitude: prop.GeoLocation?.latitude ?? null,
		longitude: prop.GeoLocation?.longitude ?? null,
		provider: "travelport",
	};
}

export async function searchTravelportStays(params: StaysSearchParams): Promise<StaysAccommodationView[]> {
	const geo = await geocodeDestination(params.destination);
	if (!geo) {
		throw new Error(`Could not find a location matching "${params.destination}" -- try a nearby city name`);
	}

	const body = {
		PropertiesQuerySearch: {
			CheckInDate: params.checkInDate,
			CheckOutDate: params.checkOutDate,
			// One RoomStayCandidate per room, guests split evenly -- Travelport
			// models occupancy per-room, unlike Duffel's flat guest list.
			RoomStayCandidate: Array.from({ length: params.rooms }, () => ({
				"@type": "RoomStayCandidate",
				GuestCounts: {
					"@type": "GuestCounts",
					GuestCount: [{ "@type": "GuestCount", count: Math.max(1, Math.round(params.adults / params.rooms)) }],
				},
			})),
			SearchBy: {
				"@type": "SearchByGeoLocation",
				// Confirmed live 2026-09-08: 43.711km returned "SEARCH RADIUS IS
				// INVALID" (code 13039) while 38.5km succeeded against the same
				// coordinates -- Travelport enforces an undocumented max
				// somewhere in that gap, so this caps at 40km rather than
				// Duffel's 100km max, which is NOT assumed to apply here.
				SearchRadius: { value: Math.min(40, Math.max(5, geo.radiusMeters / 1000)), unitOfDistance: "Kilometers" },
				Latitude: geo.latitude,
				Longitude: geo.longitude,
			},
		},
	};

	const response = await travelportPost<PropertiesSearchResponse>("/11/hotel/search/properties/search", body);
	const properties = response.PropertiesResponse.Properties?.PropertyInfo ?? [];
	return properties.map(toAccommodationView);
}
