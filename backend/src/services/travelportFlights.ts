import { travelportPost } from "../utils/travelportClient";
import { parseIsoDurationMinutes, type FlightSearchParams, type FlightOfferView, type FlightSliceView } from "./flights";

// Travelport Air search, alongside Duffel -- not a replacement. See
// travelportClient.ts for auth/header details. This is search/compare
// only: no offer re-verification, no booking, no markup (there's nothing
// to mark up yet since there's no bookable path). Content is NDC-only for
// now (contentSourceList: ["NDC"]) -- confirmed working live 2026-09-08;
// broadening to GDS content is a follow-up, not assumed to behave the
// same way.
//
// Response shape notes (from a real captured response, not just docs):
// CatalogProductOffering only carries origin/destination airport codes at
// the top level -- actual flight times/segments live in a separate
// ReferenceList, cross-referenced by id (Product -> FlightSegment ->
// Flight.FlightRef -> ReferenceListFlight.Flight[id]). One
// ProductBrandOffering.Product[] entry = one slice (1 entry for one-way,
// expected 2 for round-trip, unverified live since only one-way has been
// tested); each Product's FlightSegment[] = that slice's segments.
// ProductBrandOptions holds many fare-brand price points for the same
// routing (Basic Economy, Main Cabin, etc.) -- the cheapest one is used
// as "the" offer price, matching Duffel's one-offer-one-price model.

interface TravelportFlightDetail {
	id: string;
	carrier: string;
	number: string;
	duration: string;
	Departure: { location: string; date: string; time: string };
	Arrival: { location: string; date: string; time: string };
}

interface TravelportFlightSegment {
	sequence: number;
	Flight: { FlightRef: string };
}

interface TravelportProduct {
	id: string;
	totalDuration: string;
	FlightSegment: TravelportFlightSegment[];
}

interface TravelportPrice {
	CurrencyCode: { value: string };
	Base: number;
	TotalTaxes: number;
	TotalPrice: number;
}

interface TravelportProductBrandOffering {
	Product: { productRef: string }[];
	BestCombinablePrice: TravelportPrice;
}

interface TravelportCatalogProductOffering {
	id: string;
	Identifier: { authority: string };
	ProductBrandOptions: { ProductBrandOffering: TravelportProductBrandOffering[] }[];
}

interface CatalogProductOfferingsResponse {
	CatalogProductOfferingsResponse: {
		CatalogProductOfferings?: { CatalogProductOffering: TravelportCatalogProductOffering[] };
		// Absent (not just empty) when every source failed or found nothing for the route/date -- see Result.Error in that case.
		ReferenceList?: ({ "@type": "ReferenceListFlight"; Flight: TravelportFlightDetail[] } | { "@type": string; [key: string]: unknown })[];
	};
}

function cheapestBrandOffering(cpo: TravelportCatalogProductOffering): TravelportProductBrandOffering | null {
	const offerings = cpo.ProductBrandOptions?.[0]?.ProductBrandOffering ?? [];
	if (offerings.length === 0) return null;
	return offerings.reduce((cheapest, current) =>
		current.BestCombinablePrice.TotalPrice < cheapest.BestCombinablePrice.TotalPrice ? current : cheapest
	);
}

function toSliceView(product: TravelportProduct | undefined, flightsById: Map<string, TravelportFlightDetail>): FlightSliceView {
	const segments = (product?.FlightSegment ?? [])
		.slice()
		.sort((a, b) => a.sequence - b.sequence)
		.map((seg) => flightsById.get(seg.Flight.FlightRef))
		.filter((f): f is TravelportFlightDetail => Boolean(f));

	const first = segments[0];
	const last = segments[segments.length - 1];

	return {
		originAirport: first?.Departure.location ?? "",
		originCity: null, // Travelport doesn't return a city name at this level; airport code is enough to render
		destinationAirport: last?.Arrival.location ?? "",
		destinationCity: null,
		departingAt: first ? `${first.Departure.date}T${first.Departure.time}` : "",
		arrivingAt: last ? `${last.Arrival.date}T${last.Arrival.time}` : "",
		durationMinutes: parseIsoDurationMinutes(product?.totalDuration ?? null),
		stops: Math.max(0, segments.length - 1),
		segments: segments.map((f) => ({
			marketingCarrier: f.carrier,
			flightNumber: f.number,
			departingAt: `${f.Departure.date}T${f.Departure.time}`,
			arrivingAt: `${f.Arrival.date}T${f.Arrival.time}`,
		})),
	};
}

function toOfferView(
	cpo: TravelportCatalogProductOffering,
	productsById: Map<string, TravelportProduct>,
	flightsById: Map<string, TravelportFlightDetail>,
	adults: number
): FlightOfferView | null {
	const cheapest = cheapestBrandOffering(cpo);
	if (!cheapest) return null;

	const slices = cheapest.Product.map((p) => toSliceView(productsById.get(p.productRef), flightsById));
	const price = cheapest.BestCombinablePrice;

	return {
		id: cpo.id,
		// Travelport's response doesn't include an airline display name or
		// logo at this level, only the IATA carrier code -- showing the
		// code is an honest simplification for this pass, not a bug.
		airline: cpo.Identifier?.authority ?? "Unknown airline",
		airlineLogoUrl: null,
		slices,
		passengers: Array.from({ length: adults }, (_, i) => ({ id: `pax-${i}`, type: "adult", age: null })),
		baseAmount: price.Base,
		taxAmount: price.TotalTaxes,
		totalAmount: price.TotalPrice, // no markup applied -- nothing bookable yet to mark up
		currency: price.CurrencyCode.value,
		expiresAt: "", // Travelport doesn't surface a comparable per-offer expiry here
		provider: "travelport",
	};
}

export async function searchTravelportFlights(params: FlightSearchParams): Promise<FlightOfferView[]> {
	const SearchCriteriaFlight = [
		{ "@type": "SearchCriteriaFlight", departureDate: params.departureDate, From: { value: params.origin }, To: { value: params.destination } },
	];
	if (params.returnDate) {
		SearchCriteriaFlight.push({
			"@type": "SearchCriteriaFlight",
			departureDate: params.returnDate,
			From: { value: params.destination },
			To: { value: params.origin },
		});
	}

	const body = {
		"@type": "CatalogProductOfferingsQueryRequest",
		CatalogProductOfferingsRequest: {
			"@type": "CatalogProductOfferingsRequestAir",
			maxNumberOfUpsellsToReturn: 1,
			contentSourceList: ["NDC"],
			PassengerCriteria: [{ "@type": "PassengerCriteria", number: params.adults, passengerTypeCode: "ADT" }],
			SearchCriteriaFlight,
		},
	};

	const response = await travelportPost<CatalogProductOfferingsResponse>(
		"/11/air/catalog/search/catalogproductofferings",
		body
	);

	const data = response.CatalogProductOfferingsResponse;
	const offerings = data.CatalogProductOfferings?.CatalogProductOffering ?? [];

	const flightList = data.ReferenceList?.find((r) => r["@type"] === "ReferenceListFlight") as
		| { Flight: TravelportFlightDetail[] }
		| undefined;
	const productList = data.ReferenceList?.find((r) => r["@type"] === "ReferenceListProduct") as
		| { Product: TravelportProduct[] }
		| undefined;

	const flightsById = new Map((flightList?.Flight ?? []).map((f) => [f.id, f]));
	const productsById = new Map((productList?.Product ?? []).map((p) => [p.id, p]));

	return offerings
		.map((cpo) => toOfferView(cpo, productsById, flightsById, params.adults))
		.filter((offer): offer is FlightOfferView => offer !== null);
}
