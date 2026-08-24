import type { StaysSearchResult, StaysAccommodation } from "@duffel/api/Stays/StaysTypes";
import { getDuffelClient } from "../utils/duffelClient";
import { geocodeDestination } from "./geocoding";

// Search/browse only -- see STAGE-PLAN-11.md. Booking (quotes.create ->
// bookings.create) is deliberately not built yet: the commission rate is
// still unconfirmed with Duffel sales, and the Seller-of-Travel legal
// review is pending (shared with Flights, not yet done). Nothing here
// creates a quote, a booking, or moves money -- searching and viewing
// rates is safe to ship ahead of both.
//
// Unlike Flights (no PostGIS-locatable "place" for a route), a hotel IS a
// real place -- Duffel's own search API requires geographic coordinates,
// not a free-text destination, so this reuses the same
// geocodeDestination() already powering Explore rather than building a
// second geocoder. Duffel's `radius` is in kilometres (1-100, confirmed
// via their docs, not the SDK types which don't state a unit);
// geocodeDestination's radiusMeters is in metres, so it's converted here.

export interface StaysSearchParams {
	destination: string; // free text, e.g. "Bali" -- geocoded before calling Duffel
	checkInDate: string; // YYYY-MM-DD
	checkOutDate: string;
	rooms: number;
	adults: number;
}

export interface StaysAccommodationView {
	id: string; // this is the *search result* id, not the accommodation id -- fetchAllRates needs this one
	accommodationId: string;
	name: string;
	cityName: string;
	countryCode: string;
	rating: number | null;
	reviewScore: number | null;
	reviewCount: number | null;
	photoUrls: string[];
	amenityTypes: string[];
	cheapestRateTotalAmount: string;
	cheapestRateCurrency: string;
	latitude: number | null;
	longitude: number | null;
}

function toAccommodationView(result: StaysSearchResult): StaysAccommodationView {
	const acc: StaysAccommodation = result.accommodation;
	return {
		id: result.id,
		accommodationId: acc.id,
		name: acc.name,
		cityName: acc.location.address.city_name,
		countryCode: acc.location.address.country_code,
		rating: acc.rating,
		reviewScore: acc.review_score,
		reviewCount: acc.review_count,
		photoUrls: (acc.photos ?? []).map((p) => p.url),
		amenityTypes: (acc.amenities ?? []).map((a) => a.type),
		cheapestRateTotalAmount: result.cheapest_rate_total_amount,
		cheapestRateCurrency: result.cheapest_rate_currency,
		latitude: acc.location.geographic_coordinates?.latitude ?? null,
		longitude: acc.location.geographic_coordinates?.longitude ?? null,
	};
}

export async function searchStays(params: StaysSearchParams): Promise<StaysAccommodationView[]> {
	const geo = await geocodeDestination(params.destination);
	if (!geo) {
		throw new Error(`Could not find a location matching "${params.destination}" -- try a nearby city name`);
	}

	const duffel = getDuffelClient();
	const response = await duffel.stays.search({
		location: {
			radius: Math.min(100, Math.max(1, Math.round(geo.radiusMeters / 1000))),
			geographic_coordinates: { latitude: geo.latitude, longitude: geo.longitude },
		},
		check_in_date: params.checkInDate,
		check_out_date: params.checkOutDate,
		rooms: params.rooms,
		guests: Array.from({ length: params.adults }, () => ({ type: "adult" as const })),
	});

	return response.data.results.map(toAccommodationView);
}

export interface StaysRateView {
	id: string;
	roomName: string;
	totalAmount: string;
	currency: string;
	dueAtAccommodationAmount: string | null;
	dueAtAccommodationCurrency: string;
	boardType: string;
	// Per-rate, not a standard shape across a fare-rules-style class
	// (STAGE-PLAN-11 finding) -- passed through raw for the UI to render
	// each rate's own actual timeline, not assumed to match another.
	cancellationTimeline: unknown;
}

// Called when a traveler opens a specific property -- search() above only
// returns a cheapest-rate summary per property; this fetches the full set
// of room rates for one specific result. fetchAllRates returns the same
// StaysSearchResult shape as search() (confirmed against the installed
// types), so rooms live at accommodation.rooms, not a top-level `rooms`
// (that field is just the room *count* echoed back from the request).
export async function fetchStaysRates(searchResultId: string): Promise<StaysRateView[]> {
	const duffel = getDuffelClient();
	const response = await duffel.stays.searchResults.fetchAllRates(searchResultId);
	const rooms = response.data.accommodation.rooms ?? [];
	const rates: StaysRateView[] = [];
	for (const room of rooms) {
		for (const rate of room.rates) {
			rates.push({
				id: rate.id,
				roomName: room.name,
				totalAmount: rate.total_amount,
				currency: rate.total_currency,
				dueAtAccommodationAmount: rate.due_at_accommodation_amount,
				dueAtAccommodationCurrency: rate.due_at_accommodation_currency,
				boardType: rate.board_type,
				cancellationTimeline: rate.cancellation_timeline,
			});
		}
	}
	return rates;
}
