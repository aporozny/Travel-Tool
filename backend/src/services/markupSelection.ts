// Which markup_rules row applies to a given flight route, kept pure and free of database code
// so it can be tested on its own (tests/markupSelection.test.ts). The database side
// (fetching the candidate rows) lives in flights.ts's getActiveMarkupRule.
//
// "Route" always means the OUTBOUND leg's own origin and destination -- for a return trip
// that is the first slice's origin/destination (e.g. SYD->DPS for a Sydney-Bali return), never
// "first slice's origin to last slice's destination" (which for any round trip would just be
// back to the start airport and could never usefully key a rule).

export interface RouteMarkupRule {
	id: string;
	markup_type: string;
	markup_value: string;
	min_fee: string | null;
	max_fee: string | null;
	scope: "global" | "route" | "cabin_class";
	route_origin: string | null;
	route_destination: string | null;
}

export interface RouteKey {
	origin: string;
	destination: string;
}

// A route rule for this exact origin/destination beats the global rule; otherwise the global
// rule applies. Callers pass in whatever active rows exist (there is at most one active global
// rule, and at most one active route rule per origin/destination pair -- both enforced by a
// database constraint, not by this function).
export function pickEffectiveRule(candidates: { global: RouteMarkupRule | null; route: RouteMarkupRule | null }, forRoute: RouteKey | null): RouteMarkupRule | null {
	if (forRoute && candidates.route && candidates.route.route_origin === forRoute.origin && candidates.route.route_destination === forRoute.destination) {
		return candidates.route;
	}
	return candidates.global;
}
