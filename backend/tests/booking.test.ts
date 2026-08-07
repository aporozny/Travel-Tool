/**
 * Booking offer view (Phase 1: activities via Viator). toOfferView is the
 * single place that enforces the one hard constraint this feature exists
 * for: an operator-matched offer must never carry Drift's checkout link --
 * only the operator's own contact. A false negative here means Drift
 * quietly earns a commission on a claimed operator's own business, which
 * breaks the "zero commission, ever" promise the whole feature is built to
 * protect (this was the one real disagreement in the design review that
 * took two rounds to resolve -- worth a regression guard).
 */
import { toOfferView } from "../src/services/booking";

jest.mock("../src/utils/db", () => ({ pool: { query: jest.fn() } }));
jest.mock("../src/utils/redis", () => ({
	redis: { get: jest.fn(), setex: jest.fn() },
}));

function offerRow(overrides: Partial<Record<string, any>> = {}) {
	return {
		id: "offer-1",
		name: "Sunset Sailing Tour",
		category: "activity",
		price_amount: "45.00",
		price_currency: "USD",
		checkout_url: "https://viator.com/tours/abc123?pid=drift",
		match_status: "no_match",
		matched_operator_id: null,
		operator_name: null,
		operator_phone: null,
		operator_website: null,
		...overrides,
	};
}

describe("toOfferView", () => {
	it("no_match: surfaces the aggregator checkout link, no operator contact", () => {
		const view = toOfferView(offerRow());
		expect(view.checkoutUrl).toBe("https://viator.com/tours/abc123?pid=drift");
		expect(view.operatorContact).toBeNull();
	});

	it("ambiguous: surfaces the aggregator checkout link standalone, same as no_match", () => {
		const view = toOfferView(offerRow({ match_status: "ambiguous" }));
		expect(view.checkoutUrl).toBe("https://viator.com/tours/abc123?pid=drift");
		expect(view.operatorContact).toBeNull();
	});

	it("operator_match: NEVER surfaces the checkout link, regardless of what's in the row", () => {
		const view = toOfferView(
			offerRow({
				match_status: "operator_match",
				matched_operator_id: "op-1",
				operator_name: "Bali Sunset Cruises",
				operator_phone: "+62 812 3456",
				operator_website: "https://balisunsetcruises.example",
			}),
		);
		expect(view.checkoutUrl).toBeNull();
		expect(view.operatorContact).toEqual({
			name: "Bali Sunset Cruises",
			phone: "+62 812 3456",
			website: "https://balisunsetcruises.example",
		});
	});

	it("operator_match with no matched_operator_id somehow set: still suppresses checkoutUrl (fail closed)", () => {
		// Defense in depth -- even if match_status and matched_operator_id
		// ever disagree (shouldn't happen, but this is the constraint that
		// must never regress), checkoutUrl must stay null whenever
		// match_status says operator_match.
		const view = toOfferView(offerRow({ match_status: "operator_match", matched_operator_id: null }));
		expect(view.checkoutUrl).toBeNull();
	});

	it("parses price_amount to a real number, not a string", () => {
		const view = toOfferView(offerRow({ price_amount: "45.00" }));
		expect(view.priceAmount).toBe(45);
		expect(typeof view.priceAmount).toBe("number");
	});

	it("handles a null price_amount without throwing", () => {
		const view = toOfferView(offerRow({ price_amount: null }));
		expect(view.priceAmount).toBeNull();
	});
});
