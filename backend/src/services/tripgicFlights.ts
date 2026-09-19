import { tripgicPost } from "../utils/tripgicClient";
import type { FlightSearchParams, FlightOfferView, FlightSliceView } from "./flights";

// TripGic flight search, alongside Duffel and Travelport -- not a
// replacement. See tripgicClient.ts for auth details. Search/compare only
// for now: the booking lifecycle (validate -> update-travellers ->
// create-booking -> issue-ticket) is confirmed working against TripGic's
// sandbox but is not wired into Drift's checkout yet, so, like Travelport,
// no markup is applied here (nothing bookable through Drift to mark up
// yet) and the frontend shows these offers as compare-only.
//
// Behaviour confirmed live against the sandbox, 2026-09-19 (not just docs):
// - One endpoint, POST /flight/search, handles one-way AND round-trip
//   (journey_type + one segment per direction). The separately documented
//   "/flight/roundtrip search" path 404s.
// - price.total is the all-passenger total (2 adults doubled it), matching
//   the meaning of FlightOfferView.totalAmount.
// - A search with no results comes back as status "failed" with a reason,
//   not an empty list -- that must map to [], not an error, or a route
//   with no TripGic inventory would log a failure on every search.
// - partner_id is our own account id (TRIPGIC_PARTNER_ID, currently 15 =
//   the Quattro Finance sandbox account). Sending the docs example "1"
//   searches on behalf of TripGic's own sandbox master partner instead.
// - Durations use a non-standard ISO form that can include days
//   ("PT1D4H40M"), which the shared parseIsoDurationMinutes() would read
//   as 0 -- so this file parses its own.

interface TripgicRoute {
	origin: string;
	departure_time: string; // "2026-11-15 07:55", local time at the airport
	origin_airport?: { city?: string };
	destination: string;
	arrival_time: string;
	destination_airport?: { city?: string };
	marketing: { carrier_name?: string; flight_number?: string; carrier_logo?: string };
}

interface TripgicFlightGroup {
	flight_time: string | null; // total journey time for this direction, including layovers
	routes: TripgicRoute[];
}

interface TripgicOffer {
	tracking_id: string;
	flight_key: string;
	flight_group: TripgicFlightGroup[];
	price: { currency: string; total: number; base_fare: number; tax: number };
}

interface TripgicSearchResponse {
	status: string;
	reason?: string | null;
	data?: TripgicOffer[];
	resources?: { base_url?: { carrier?: string } };
}

const CABIN_CLASS: Record<NonNullable<FlightSearchParams["cabinClass"]>, string> = {
	economy: "Economy",
	premium_economy: "Premium-Economy",
	business: "Business",
	first: "First-Class",
};

function requirePartnerId(): string {
	const value = process.env.TRIPGIC_PARTNER_ID;
	if (!value) {
		throw new Error("TRIPGIC_PARTNER_ID not configured -- TripGic search is inactive");
	}
	return value;
}

// "PT6H30M" -> 390, "PT1D4H40M" -> 1720, "P1DT4H40M" -> 1720.
function parseTripgicDurationMinutes(duration: string | null): number | null {
	if (!duration) return null;
	const match = duration.match(/^P?T?(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?$/);
	if (!match || (!match[1] && !match[2] && !match[3])) return null;
	const days = match[1] ? parseInt(match[1], 10) : 0;
	const hours = match[2] ? parseInt(match[2], 10) : 0;
	const minutes = match[3] ? parseInt(match[3], 10) : 0;
	return days * 1440 + hours * 60 + minutes;
}

// "2026-11-15 07:55" -> "2026-11-15T07:55:00" (local airport time, no
// offset -- same convention Duffel's departing_at/arriving_at use).
function toIsoLocal(dateTime: string | undefined): string {
	if (!dateTime) return "";
	return `${dateTime.trim().replace(" ", "T")}:00`;
}

function toSliceView(group: TripgicFlightGroup): FlightSliceView {
	const routes = group.routes ?? [];
	const first = routes[0];
	const last = routes[routes.length - 1];
	return {
		originAirport: first?.origin ?? "",
		originCity: first?.origin_airport?.city ?? null,
		destinationAirport: last?.destination ?? "",
		destinationCity: last?.destination_airport?.city ?? null,
		departingAt: toIsoLocal(first?.departure_time),
		arrivingAt: toIsoLocal(last?.arrival_time),
		durationMinutes: parseTripgicDurationMinutes(group.flight_time),
		stops: Math.max(0, routes.length - 1),
		segments: routes.map((r) => ({
			marketingCarrier: r.marketing?.carrier_name ?? "Unknown",
			flightNumber: r.marketing?.flight_number ?? "",
			departingAt: toIsoLocal(r.departure_time),
			arrivingAt: toIsoLocal(r.arrival_time),
		})),
	};
}

function toOfferView(offer: TripgicOffer, adults: number, logoBaseUrl: string | undefined): FlightOfferView {
	const firstMarketing = offer.flight_group?.[0]?.routes?.[0]?.marketing;
	const logoFile = firstMarketing?.carrier_logo;
	return {
		// A booking needs both halves later (validate takes tracking_id +
		// flight_key), and flight_key alone repeats across searches.
		id: `${offer.tracking_id}:${offer.flight_key}`,
		airline: firstMarketing?.carrier_name ?? "Unknown airline",
		airlineLogoUrl: logoBaseUrl && logoFile ? `${logoBaseUrl}/${logoFile}` : null,
		slices: (offer.flight_group ?? []).map(toSliceView),
		passengers: Array.from({ length: adults }, (_, i) => ({ id: `pax-${i}`, type: "adult", age: null })),
		baseAmount: Number(offer.price.base_fare),
		taxAmount: Number(offer.price.tax),
		totalAmount: Number(offer.price.total), // no markup applied -- nothing bookable through Drift yet
		currency: offer.price.currency,
		expiresAt: "", // per-offer expiry isn't in the search response; validate returns a session expiry instead
		provider: "tripgic",
	};
}

export async function searchTripgicFlights(params: FlightSearchParams): Promise<FlightOfferView[]> {
	const segment = (from: string, to: string, date: string) => ({
		departure_airport_type: "AIRPORT",
		departure_airport: from,
		arrival_airport_type: "AIRPORT",
		arrival_airport: to,
		departure_date: date,
	});

	const segments = [segment(params.origin, params.destination, params.departureDate)];
	if (params.returnDate) segments.push(segment(params.destination, params.origin, params.returnDate));

	const response = await tripgicPost<TripgicSearchResponse>("/flight/search", {
		journey_type: params.returnDate ? "RoundTrip" : "OneWay",
		segment: segments,
		travelers_adult: params.adults,
		travelers_child: 0,
		travelers_infants: 0,
		preferred_carrier: [],
		non_stop_flight: "any",
		baggage_option: "any",
		booking_class: CABIN_CLASS[params.cabinClass ?? "economy"],
		partner_id: requirePartnerId(),
		language: "en",
	});

	if (response.status !== "success") {
		if (/no flights available/i.test(response.reason ?? "")) return [];
		throw new Error(`TripGic flight search failed: ${response.reason ?? "unknown reason"}`);
	}

	const logoBaseUrl = response.resources?.base_url?.carrier;
	return (response.data ?? []).map((offer) => toOfferView(offer, params.adults, logoBaseUrl));
}
