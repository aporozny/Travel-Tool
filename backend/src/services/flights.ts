// Offer (the data shape) isn't re-exported through the top-level
// @duffel/api module -- only the resource classes are. Confirmed against
// the installed package's own typings.d.ts rather than guessed.
import type { Offer } from "@duffel/api/booking/Offers/OfferTypes";
import crypto from "crypto";
import { pool } from "../utils/db";
import { getDuffelClient as getClient } from "../utils/duffelClient";
import { pickEffectiveRule } from "./markupSelection";

// Flight search/booking via Duffel. Ships inactive: every function below
// throws a clear "not configured" error until DUFFEL_API_KEY is set --
// same fail-closed default as every other credential-gated feature in
// this codebase (Viator, the voice agent). See STAGE-PLAN-7 for the
// multi-agent research this is built from, including why this does NOT
// reuse places_cache/bookable_offers (no PostGIS-locatable "place" for a
// flight route, and the zero-commission-to-operators enforcement in
// booking.ts's matchOfferToOperator() has no equivalent here -- airlines
// are never a Drift-claimed local listing).

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

export interface FlightOfferPassengerView {
	id: string;
	type: string | null;
	age: number | null;
}

export interface FlightOfferView {
	id: string;
	airline: string;
	airlineLogoUrl: string | null;
	slices: FlightSliceView[];
	passengers: FlightOfferPassengerView[];
	baseAmount: number;
	taxAmount: number;
	totalAmount: number; // includes Drift's markup
	currency: string;
	expiresAt: string;
	provider: "duffel" | "travelport" | "tripgic";
}

// "PT14H30M" -> 870. Duffel and Travelport both return ISO 8601 durations
// (same standard), so this is shared rather than duplicated per provider.
export function parseIsoDurationMinutes(iso: string | null): number | null {
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

// Active markup rule, applied to a base Duffel price. The seed row (8%, $5-150 cap) is a
// placeholder for the whole account (scope 'global'); a route can now override it with its own
// rule (scope 'route') -- see services/markupRules.ts for managing those, and
// services/markupSelection.ts for the (pure, tested) rule which wins when both exist.
export interface MarkupRule {
	id: string;
	markup_type: string;
	markup_value: string;
	min_fee: string | null;
	max_fee: string | null;
}

// The outbound leg's own origin/destination, e.g. SYD/DPS for a Sydney-Bali return -- never
// derived from a multi-slice itinerary's first-origin-to-last-destination, which for any round
// trip is just back to the start airport. Used everywhere a route-scoped markup rule is looked up.
export interface FlightRoute {
	origin: string;
	destination: string;
}

const ROUTE_RULE_COLUMNS = "id, markup_type, markup_value, min_fee, max_fee, scope, route_origin, route_destination";

export async function getActiveMarkupRule(route?: FlightRoute): Promise<MarkupRule> {
	const globalRow = (await pool.query(`SELECT ${ROUTE_RULE_COLUMNS} FROM markup_rules WHERE scope = 'global' AND active = true LIMIT 1`)).rows[0] ?? null;
	let routeRow = null;
	if (route) {
		routeRow = (await pool.query(
			`SELECT ${ROUTE_RULE_COLUMNS} FROM markup_rules WHERE scope = 'route' AND active = true AND route_origin = $1 AND route_destination = $2 LIMIT 1`,
			[route.origin, route.destination]
		)).rows[0] ?? null;
	}
	const rule = pickEffectiveRule({ global: globalRow, route: routeRow }, route ?? null);
	if (!rule) throw new Error("No active global markup_rules row -- flight pricing cannot be calculated");
	return rule;
}

export function computeMarkup(baseAmount: number, rule: MarkupRule): { totalAmount: number; markupAmount: number; ruleId: string } {
	let markupAmount = rule.markup_type === "percentage" ? baseAmount * parseFloat(rule.markup_value) : parseFloat(rule.markup_value);
	if (rule.min_fee != null) markupAmount = Math.max(markupAmount, parseFloat(rule.min_fee));
	if (rule.max_fee != null) markupAmount = Math.min(markupAmount, parseFloat(rule.max_fee));
	return { totalAmount: baseAmount + markupAmount, markupAmount, ruleId: rule.id };
}

// Single-offer convenience wrapper for the checkout call sites below, which
// only ever price one offer at a time. searchFlights() below deliberately
// does NOT use this -- fetching the rule fresh per offer in a loop of
// potentially dozens of offers was the actual cause of ~20s search times
// (N sequential DB round trips); it fetches the rule once instead.
export async function applyMarkup(baseAmount: number, route?: FlightRoute): Promise<{ totalAmount: number; markupAmount: number; ruleId: string }> {
	const rule = await getActiveMarkupRule(route);
	return computeMarkup(baseAmount, rule);
}

// The route a Duffel offer's outbound slice represents, for a route-scoped markup lookup.
export function routeOfOffer(offer: Pick<Offer, "slices">): FlightRoute | undefined {
	const first = offer.slices?.[0];
	const origin = first?.origin?.iata_code;
	const destination = first?.destination?.iata_code;
	return origin && destination ? { origin, destination } : undefined;
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
		passengers: (offer.passengers ?? []).map((p) => ({ id: p.id, type: p.type, age: p.age })),
		baseAmount: parseFloat(offer.base_amount),
		taxAmount: offer.tax_amount ? parseFloat(offer.tax_amount) : 0,
		totalAmount: markedUpTotal,
		currency: offer.total_currency,
		expiresAt: offer.expires_at,
		provider: "duffel",
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

	// Fetch the markup rule once, not once per offer (see comment on
	// applyMarkup above) -- markupAmount/ruleId aren't persisted at
	// search time regardless; they get resnapshotted at order creation,
	// since the markup that matters is the one active when the traveler
	// actually books, not when they searched.
	const rule = await getActiveMarkupRule({ origin: params.origin, destination: params.destination });

	// Independent per-offer cache writes -- run concurrently instead of
	// one at a time. With Duffel test mode routinely returning dozens of
	// offers, sequential awaits here were the actual cause of ~20s
	// search times.
	const views = await Promise.all(
		offers.map(async (offer) => {
			const baseAmount = parseFloat(offer.base_amount);
			const taxAmount = offer.tax_amount ? parseFloat(offer.tax_amount) : 0;
			const { totalAmount } = computeMarkup(baseAmount + taxAmount, rule);

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

			return toOfferView(offer, totalAmount);
		})
	);

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

// Checkout (payment intent -> confirm -> order) lives in flightPayments.ts, which records
// every payment in the flight_payments ledger. The reasoning for choosing Duffel Payment
// Intents over the other two payment methods (see RISK-REGISTER.md R12) is unchanged:
// plain Card passthrough forbids any markup, and plain pre-funded Balance would need a
// second card processor. Payment Intents let Duffel's hosted card form charge the traveller
// the marked-up total directly, crediting Drift's Balance before the order is placed, so raw
// card data never touches Drift's servers (PCI scope stays SAQ-A).

export interface FlightOrderSummaryView {
	id: string;
	bookingReference: string;
	status: string;
	priceChargedAmount: number;
	priceChargedCurrency: string;
	createdAt: string;
	slices: FlightSliceView[];
}

// order.slices, stored verbatim as jsonb at booking time (createFlightOrder
// above), is Duffel's OrderSlice[] -- structurally the same origin/
// destination/duration/segments shape as Offer["slices"][number] that
// toSliceView() already maps (both verified against the real installed
// types), so the same field access is reused here rather than duplicated.
function orderSliceToView(slice: any): FlightSliceView {
	return toSliceView(slice);
}

// The traveler's own past bookings -- there was no way to see a flight
// order again after the confirmation screen closed until this existed.
export async function listFlightOrders(userId: string): Promise<FlightOrderSummaryView[]> {
	const { rows } = await pool.query(
		`SELECT id, booking_reference, status, price_charged_amount, price_charged_currency, created_at, slices
		 FROM flight_orders WHERE user_id = $1 ORDER BY created_at DESC`,
		[userId]
	);
	return rows.map((row) => ({
		id: row.id,
		bookingReference: row.booking_reference,
		status: row.status,
		priceChargedAmount: parseFloat(row.price_charged_amount),
		priceChargedCurrency: row.price_charged_currency,
		createdAt: row.created_at,
		slices: (row.slices ?? []).map(orderSliceToView),
	}));
}
