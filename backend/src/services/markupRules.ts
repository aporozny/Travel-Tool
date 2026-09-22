import { z } from "zod";
import { pool } from "../utils/db";
import { getRateTable, convert } from "./fx";
import { searchFlights } from "./flights";
import { searchTripgicFlights } from "./tripgicFlights";
import { searchTravelportFlights } from "./travelportFlights";
import { pickEffectiveRule, type RouteMarkupRule } from "./markupSelection";
import type { FlightSearchParams, FlightOfferView } from "./flights";

// Managing markup_rules (the CRUD side of the route-scoped markup added in migration 047), and
// the "supplier scorecard": for one route, what each supplier's cheapest fare actually costs
// Drift, what the traveller is charged today, and the margin in between -- so a route-scoped
// rule (or a decision to add TravelOpro, drop a supplier, etc.) is a data-informed call rather
// than a guess. See services/markupSelection.ts for which rule wins when a route has its own.

export class MarkupRuleError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}

export interface MarkupRuleRow {
	id: string;
	scope: "global" | "route" | "cabin_class";
	route_origin: string | null;
	route_destination: string | null;
	markup_type: "percentage" | "fixed";
	markup_value: string;
	min_fee: string | null;
	max_fee: string | null;
	active: boolean;
	created_at: string;
}

export async function listMarkupRules(): Promise<MarkupRuleRow[]> {
	const { rows } = await pool.query(
		`SELECT id, scope, route_origin, route_destination, markup_type, markup_value, min_fee, max_fee, active, created_at
		 FROM markup_rules ORDER BY active DESC, scope, route_origin NULLS FIRST, created_at DESC`
	);
	return rows;
}

const iata = z.string().trim().toUpperCase().length(3).regex(/^[A-Z]{3}$/, "Must be a 3-letter airport code");

export const createMarkupRuleSchema = z
	.object({
		scope: z.enum(["global", "route"]), // cabin_class exists in the schema but nothing reads it yet -- not exposed here
		routeOrigin: iata.optional(),
		routeDestination: iata.optional(),
		markupType: z.enum(["percentage", "fixed"]),
		// A percentage is stored as a fraction (0.08 = 8%), matching the seed row and computeMarkup's
		// own reading of it -- the API takes a fraction too, not "8" meaning 8, to avoid that mistake.
		markupValue: z.number().positive().max(1000),
		minFee: z.number().min(0).optional(),
		maxFee: z.number().min(0).optional(),
	})
	.refine((v) => v.scope !== "route" || (v.routeOrigin && v.routeDestination), { message: "routeOrigin and routeDestination are required for a route rule", path: ["routeOrigin"] })
	.refine((v) => v.scope !== "route" || v.routeOrigin !== v.routeDestination, { message: "Origin and destination cannot be the same", path: ["routeDestination"] })
	.refine((v) => v.markupType !== "percentage" || v.markupValue < 1, { message: "A percentage markup should be a fraction, e.g. 0.08 for 8% -- 1 would mean 100%", path: ["markupValue"] })
	.refine((v) => v.minFee == null || v.maxFee == null || v.minFee <= v.maxFee, { message: "minFee cannot be more than maxFee", path: ["minFee"] });

export type CreateMarkupRuleInput = z.infer<typeof createMarkupRuleSchema>;

// Creating a rule for a key that already has an active one replaces it (the old row is kept,
// just deactivated, for history) rather than erroring -- the admin screen just wants "set the
// rule for this route to X", not to manage deactivation as a separate step first.
export async function createMarkupRule(input: CreateMarkupRuleInput): Promise<MarkupRuleRow> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		if (input.scope === "global") {
			await client.query(`UPDATE markup_rules SET active = false WHERE scope = 'global' AND active = true`);
		} else {
			await client.query(
				`UPDATE markup_rules SET active = false WHERE scope = 'route' AND active = true AND route_origin = $1 AND route_destination = $2`,
				[input.routeOrigin, input.routeDestination]
			);
		}
		const { rows } = await client.query(
			`INSERT INTO markup_rules (scope, route_origin, route_destination, markup_type, markup_value, min_fee, max_fee, active)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,true)
			 RETURNING id, scope, route_origin, route_destination, markup_type, markup_value, min_fee, max_fee, active, created_at`,
			[input.scope, input.routeOrigin ?? null, input.routeDestination ?? null, input.markupType, input.markupValue, input.minFee ?? null, input.maxFee ?? null]
		);
		await client.query("COMMIT");
		return rows[0];
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
}

export async function setMarkupRuleActive(id: string, active: boolean): Promise<MarkupRuleRow> {
	const { rows } = await pool.query(
		`UPDATE markup_rules SET active = $2 WHERE id = $1
		 RETURNING id, scope, route_origin, route_destination, markup_type, markup_value, min_fee, max_fee, active, created_at`,
		[id, active]
	);
	if (!rows.length) throw new MarkupRuleError(404, "No such markup rule");
	return rows[0];
}

// ─── The scorecard ───────────────────────────────────────────────────────────

export interface ProviderQuote {
	provider: "duffel" | "tripgic" | "travelport";
	offerCount: number;
	error: string | null;
	cheapest: {
		airline: string;
		costAmount: number; // what the supplier actually charges Drift (base + tax), before markup
		costCurrency: string;
		priceAmount: number; // what the traveller is shown today (after whatever markup applies)
		priceCurrency: string;
		costInEur: number | null;
		priceInEur: number | null;
		marginInEur: number | null; // null for a provider nothing is marked up on yet (Travelport)
		marginPercentOfCost: number | null;
	} | null;
}

export interface ScorecardResult {
	origin: string;
	destination: string;
	departureDate: string;
	returnDate: string | null;
	adults: number;
	effectiveMarkupRule: MarkupRuleRow | null;
	providers: ProviderQuote[];
}

function cheapestOf(offers: FlightOfferView[]): FlightOfferView | null {
	return offers.length ? offers.reduce((best, o) => (o.totalAmount < best.totalAmount ? o : best)) : null;
}

async function toQuote(provider: ProviderQuote["provider"], offers: FlightOfferView[] | null, error: string | null, rates: Awaited<ReturnType<typeof getRateTable>>, markedUp: boolean): Promise<ProviderQuote> {
	const cheapest = offers ? cheapestOf(offers) : null;
	if (!cheapest) return { provider, offerCount: offers?.length ?? 0, error, cheapest: null };
	const costAmount = cheapest.baseAmount + cheapest.taxAmount;
	const costInEur = convert(rates, costAmount, cheapest.currency, "EUR");
	const priceInEur = convert(rates, cheapest.totalAmount, cheapest.currency, "EUR");
	const marginInEur = markedUp && costInEur != null && priceInEur != null ? priceInEur - costInEur : null;
	return {
		provider,
		offerCount: offers!.length,
		error: null,
		cheapest: {
			airline: cheapest.airline,
			costAmount, costCurrency: cheapest.currency,
			priceAmount: cheapest.totalAmount, priceCurrency: cheapest.currency,
			costInEur, priceInEur, marginInEur,
			marginPercentOfCost: marginInEur != null && costInEur ? (marginInEur / costInEur) * 100 : null,
		},
	};
}

// Runs the same three-provider search the traveller-facing /flights/search route does (so the
// numbers here are the numbers a real search would show), then adds Drift's own cost and margin
// on top -- something no traveller-facing response needs, but an admin pricing decision does.
export async function buildScorecard(params: FlightSearchParams): Promise<ScorecardResult> {
	const [duffel, tripgic, travelport, rates, effectiveRule] = await Promise.all([
		searchFlights(params).then((offers) => ({ offers, error: null })).catch((err) => ({ offers: null, error: describeSearchError(err) })),
		searchTripgicFlights(params).then((offers) => ({ offers, error: null })).catch((err) => ({ offers: null, error: describeSearchError(err) })),
		searchTravelportFlights(params).then((offers) => ({ offers, error: null })).catch((err) => ({ offers: null, error: describeSearchError(err) })),
		getRateTable(),
		getEffectiveRuleRow({ origin: params.origin, destination: params.destination }),
	]);

	const providers = await Promise.all([
		toQuote("duffel", duffel.offers, duffel.error, rates, true),
		toQuote("tripgic", tripgic.offers, tripgic.error, rates, true),
		// Travelport is search-only today -- nothing is marked up on it because nothing is bookable
		// yet (see travelportFlights.ts), so its "margin" would be meaningless, not just zero.
		toQuote("travelport", travelport.offers, travelport.error, rates, false),
	]);

	return {
		origin: params.origin, destination: params.destination, departureDate: params.departureDate,
		returnDate: params.returnDate ?? null, adults: params.adults,
		effectiveMarkupRule: effectiveRule, providers,
	};
}

function describeSearchError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// Same precedence rule flights.ts's getActiveMarkupRule uses (route beats global), reused here
// rather than re-implemented, so the scorecard can never disagree with what a real booking gets.
async function getEffectiveRuleRow(route: { origin: string; destination: string }): Promise<MarkupRuleRow | null> {
	const cols = "id, scope, route_origin, route_destination, markup_type, markup_value, min_fee, max_fee, active, created_at";
	const [globalRow, routeRow] = await Promise.all([
		pool.query(`SELECT ${cols} FROM markup_rules WHERE scope = 'global' AND active = true LIMIT 1`).then((r) => r.rows[0] as RouteMarkupRule | undefined ?? null),
		pool.query(`SELECT ${cols} FROM markup_rules WHERE scope = 'route' AND active = true AND route_origin = $1 AND route_destination = $2 LIMIT 1`, [route.origin, route.destination])
			.then((r) => r.rows[0] as RouteMarkupRule | undefined ?? null),
	]);
	return (pickEffectiveRule({ global: globalRow, route: routeRow }, route) as MarkupRuleRow | null) ?? null;
}
