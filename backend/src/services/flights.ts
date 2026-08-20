import { Duffel } from "@duffel/api";
// Offer (the data shape) isn't re-exported through the top-level
// @duffel/api module -- only the resource classes are. Confirmed against
// the installed package's own typings.d.ts rather than guessed.
import type { Offer } from "@duffel/api/booking/Offers/OfferTypes";
import crypto from "crypto";
import { pool } from "../utils/db";

// Flight search/booking via Duffel. Ships inactive: every function below
// throws a clear "not configured" error until DUFFEL_API_KEY is set --
// same fail-closed default as every other credential-gated feature in
// this codebase (Viator, the voice agent). See STAGE-PLAN-7 for the
// multi-agent research this is built from, including why this does NOT
// reuse places_cache/bookable_offers (no PostGIS-locatable "place" for a
// flight route, and the zero-commission-to-operators enforcement in
// booking.ts's matchOfferToOperator() has no equivalent here -- airlines
// are never a Drift-claimed local listing).

let client: Duffel | null = null;

function getClient(): Duffel {
	if (!process.env.DUFFEL_API_KEY) {
		throw new Error("DUFFEL_API_KEY not configured -- flight booking is inactive");
	}
	if (!client) {
		client = new Duffel({ token: process.env.DUFFEL_API_KEY });
	}
	return client;
}

export interface FlightSearchParams {
	origin: string; // IATA code, e.g. "SYD"
	destination: string; // IATA code, e.g. "DPS"
	departureDate: string; // YYYY-MM-DD
	returnDate?: string; // YYYY-MM-DD, omit for one-way
	adults: number;
	cabinClass?: "economy" | "premium_economy" | "business" | "first";
}

export interface FlightSegmentView {
	marketingCarrier: string;
	flightNumber: string;
	departingAt: string;
	arrivingAt: string;
}

export interface FlightSliceView {
	originAirport: string;
	originCity: string | null;
	destinationAirport: string;
	destinationCity: string | null;
	departingAt: string;
	arrivingAt: string;
	durationMinutes: number | null;
	stops: number;
	segments: FlightSegmentView[];
}

export interface FlightOfferView {
	id: string;
	airline: string;
	airlineLogoUrl: string | null;
	slices: FlightSliceView[];
	baseAmount: number;
	taxAmount: number;
	totalAmount: number; // includes Drift's markup
	currency: string;
	expiresAt: string;
}

// "PT14H30M" -> 870. Duffel returns ISO 8601 durations; nothing in this
// codebase already parses them, and pulling in a library for one regex
// felt like overkill.
function parseIsoDurationMinutes(iso: string | null): number | null {
	if (!iso) return null;
	const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
	if (!match) return null;
	const hours = match[1] ? parseInt(match[1], 10) : 0;
	const minutes = match[2] ? parseInt(match[2], 10) : 0;
	return hours * 60 + minutes;
}

function toSliceView(slice: Offer["slices"][number]): FlightSliceView {
	const segments = slice.segments ?? [];
	const first = segments[0];
	const last = segments[segments.length - 1];
	return {
		originAirport: slice.origin?.iata_code ?? "",
		originCity: (slice.origin as any)?.city_name ?? (slice.origin as any)?.city?.name ?? null,
		destinationAirport: slice.destination?.iata_code ?? "",
		destinationCity: (slice.destination as any)?.city_name ?? (slice.destination as any)?.city?.name ?? null,
		departingAt: first?.departing_at ?? "",
		arrivingAt: last?.arriving_at ?? "",
		durationMinutes: parseIsoDurationMinutes(slice.duration),
		stops: Math.max(0, segments.length - 1),
		segments: segments.map((seg) => ({
			marketingCarrier: seg.marketing_carrier?.name ?? seg.operating_carrier?.name ?? "Unknown",
			flightNumber: seg.marketing_carrier_flight_number ?? "",
			departingAt: seg.departing_at,
			arrivingAt: seg.arriving_at,
		})),
	};
}

function searchKeyFor(params: FlightSearchParams): string {
	const normalized = JSON.stringify({
		o: params.origin,
		d: params.destination,
		dep: params.departureDate,
		ret: params.returnDate ?? null,
		pax: params.adults,
		cabin: params.cabinClass ?? "economy",
	});
	return crypto.createHash("sha256").update(normalized).digest("hex");
}

// Active markup rule, applied to a base Duffel price. Global-scope only
// for now -- route/cabin_class-scoped rules exist in the schema but
// aren't selected here yet, since no product decision on differentiated
// pricing has been made (see markup_rules' seed row: 8%, $5-150 cap,
// explicitly a placeholder).
async function applyMarkup(baseAmount: number): Promise<{ totalAmount: number; markupAmount: number; ruleId: string }> {
	const { rows } = await pool.query(
		`SELECT id, markup_type, markup_value, min_fee, max_fee FROM markup_rules WHERE scope = 'global' AND active = true LIMIT 1`
	);
	if (!rows.length) throw new Error("No active global markup_rules row -- flight pricing cannot be calculated");
	const rule = rows[0];

	let markupAmount = rule.markup_type === "percentage" ? baseAmount * parseFloat(rule.markup_value) : parseFloat(rule.markup_value);
	if (rule.min_fee != null) markupAmount = Math.max(markupAmount, parseFloat(rule.min_fee));
	if (rule.max_fee != null) markupAmount = Math.min(markupAmount, parseFloat(rule.max_fee));

	return { totalAmount: baseAmount + markupAmount, markupAmount, ruleId: rule.id };
}

// The offers returned inline on an OfferRequest are typed
// Omit<Offer, 'available_services'> (confirmed at typings.d.ts:2628) --
// narrower than the full Offer returned by offers.get(). Neither this
// function nor reverifyOffer's caller needs available_services, so this
// accepts the narrower shape both call sites can actually provide.
function toOfferView(offer: Omit<Offer, "available_services">, markedUpTotal: number): FlightOfferView {
	return {
		id: offer.id,
		airline: offer.owner?.name ?? "Unknown airline",
		airlineLogoUrl: offer.owner?.logo_symbol_url ?? null,
		slices: (offer.slices ?? []).map(toSliceView),
		baseAmount: parseFloat(offer.base_amount),
		taxAmount: offer.tax_amount ? parseFloat(offer.tax_amount) : 0,
		totalAmount: markedUpTotal,
		currency: offer.total_currency,
		expiresAt: offer.expires_at,
	};
}

// Creates a Duffel offer request and caches the returned offers. No
// read-through cache check on the way in -- unlike bookable_offers,
// flight search is inherently a live query (prices/availability change
// per-request), the cache exists so a later "book this specific offer"
// step can re-verify against what was actually shown, not to avoid
// calling Duffel.
export async function searchFlights(params: FlightSearchParams): Promise<FlightOfferView[]> {
	const duffel = getClient();
	const searchKey = searchKeyFor(params);

	// arrival_time/departure_time are required fields on CreateOfferRequestSlice
	// (nullable, but must be present) -- null means "no time-of-day filter."
	const slices = [
		{ origin: params.origin, destination: params.destination, departure_date: params.departureDate, arrival_time: null, departure_time: null },
	];
	if (params.returnDate) {
		slices.push({ origin: params.destination, destination: params.origin, departure_date: params.returnDate, arrival_time: null, departure_time: null });
	}

	const response = await duffel.offerRequests.create({
		slices,
		passengers: Array.from({ length: params.adults }, () => ({ type: "adult" as const })),
		cabin_class: params.cabinClass ?? "economy",
		return_offers: true,
	});

	const offers = "offers" in response.data ? response.data.offers : [];
	const views: FlightOfferView[] = [];

	for (const offer of offers) {
		const baseAmount = parseFloat(offer.base_amount);
		const taxAmount = offer.tax_amount ? parseFloat(offer.tax_amount) : 0;
		const { totalAmount, markupAmount, ruleId } = await applyMarkup(baseAmount + taxAmount);

		await pool.query(
			`INSERT INTO flight_offers_cache
			   (search_key, duffel_offer_id, duffel_offer_request_id, slices, passenger_types, cabin_class,
			    base_amount, base_currency, tax_amount, total_amount, total_currency, fare_conditions,
			    owner_airline_iata, expires_at, raw_response)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
			 ON CONFLICT (duffel_offer_id) DO UPDATE SET fetched_at = NOW()`,
			[
				searchKey,
				offer.id,
				response.data.id,
				JSON.stringify(offer.slices),
				JSON.stringify(offer.passengers),
				params.cabinClass ?? "economy",
				baseAmount,
				offer.base_currency,
				taxAmount,
				offer.total_amount,
				offer.total_currency,
				JSON.stringify(offer.conditions ?? null),
				offer.owner?.iata_code ?? null,
				offer.expires_at,
				JSON.stringify(offer),
			]
		);

		// markupAmount/ruleId are computed per-offer above but not yet
		// persisted at search time -- they get resnapshotted at order
		// creation (see createFlightOrder, not yet implemented), since
		// the markup that matters is the one active when the traveler
		// actually books, not when they searched.
		void markupAmount;
		void ruleId;

		views.push(toOfferView(offer, totalAmount));
	}

	return views;
}

// Re-fetches a single offer by ID directly from Duffel (not from the
// cache) to confirm it's still valid immediately before booking --
// Duffel's own expires_at is often under 20 minutes, sometimes under 2,
// so trusting a cached row at booking time would risk creating an order
// against a price that's no longer honored.
export async function reverifyOffer(duffelOfferId: string): Promise<Offer> {
	const duffel = getClient();
	const response = await duffel.offers.get(duffelOfferId);
	return response.data;
}

// TODO (next phase, blocked on a payment architecture decision, not a
// technical unknown): createFlightOrder(offerId, passengers, paymentRef).
// Per the Duffel API research, this needs Duffel's hosted card-payment
// component so raw card data never touches Drift's servers (keeps PCI
// scope to SAQ-A) -- the order-creation call itself
// (duffel.orders.create) is straightforward once that's wired in.
// Passenger data must be written to flight_order_passengers with
// passport_number_enc via pgcrypto, never plaintext, never logged.
