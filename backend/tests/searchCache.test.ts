/**
 * Coverage-gating logic (Discovery Engine). Locks the per-category
 * live-fetch planning behaviour behind the "Fix category-blind coverage"
 * bug fix — this is exactly the decision logic that let Singapore sit at
 * 18 activity / 2 food / 0 accommodation / 0 transport for a week before
 * anyone noticed, so it needs a real regression guard.
 */
import { planLiveTopUp, MIN_COVERAGE } from "../src/services/searchCache";

// Redis/pg are imported transitively by searchCache.ts (via googlePlaces,
// geocoding, viator, foursquare, recommendations) — mock so tests need no
// live services. planLiveTopUp itself is pure (no I/O).
jest.mock("../src/utils/db", () => ({ pool: { query: jest.fn() } }));
jest.mock("../src/utils/redis", () => ({
	redis: { get: jest.fn(), setex: jest.fn(), incrby: jest.fn(), expire: jest.fn() },
}));

function coverage(overrides: Partial<Record<string, number>> = {}) {
	const base: Record<string, number> = {
		food: MIN_COVERAGE,
		accommodation: MIN_COVERAGE,
		activity: MIN_COVERAGE,
		transport: MIN_COVERAGE,
	};
	Object.assign(base, overrides);
	return Object.entries(base).map(([cat, cov]) => ({ cat, coverage: cov }));
}

describe("planLiveTopUp", () => {
	it("fires no live calls when every category already meets MIN_COVERAGE", () => {
		const plan = planLiveTopUp(coverage(), true, true);
		expect(plan.thinCategories).toEqual([]);
		expect(plan.totalCalls).toBe(0);
		expect(plan.willCallViator).toBe(false);
		expect(plan.willCallFoursquare).toBe(false);
	});

	it("treats exactly MIN_COVERAGE as sufficient (boundary is exclusive below)", () => {
		const plan = planLiveTopUp(coverage({ food: MIN_COVERAGE - 1 }), false, false);
		expect(plan.thinCategories).toEqual(["food"]);
	});

	it("reproduces the original Singapore bug scenario: only accommodation and transport are thin", () => {
		// 18 activity, 2 food is what the aggregate-coverage bug used to
		// consider "covered" overall -- per-category planning must still
		// flag accommodation/transport as thin even though the total row
		// count across categories is well past any single threshold.
		const plan = planLiveTopUp(
			coverage({ activity: 18, food: 2, accommodation: 0, transport: 0 }),
			true,
			true,
		);
		expect(plan.thinCategories.sort()).toEqual(["accommodation", "food", "transport"]);
	});

	it("only calls Viator when activity is actually thin, even if Viator is available", () => {
		const plan = planLiveTopUp(coverage({ food: 0 }), true, true);
		expect(plan.thinCategories).toEqual(["food"]);
		expect(plan.willCallViator).toBe(false);
	});

	it("calls Viator when activity is thin and Viator is available", () => {
		const plan = planLiveTopUp(coverage({ activity: 0 }), true, false);
		expect(plan.willCallViator).toBe(true);
	});

	it("never calls Viator when it's unavailable for this destination, even if activity is thin", () => {
		const plan = planLiveTopUp(coverage({ activity: 0 }), false, true);
		expect(plan.willCallViator).toBe(false);
	});

	it("calls Foursquare whenever anything is thin and it's available, regardless of which category", () => {
		const plan = planLiveTopUp(coverage({ transport: 0 }), false, true);
		expect(plan.willCallFoursquare).toBe(true);
	});

	it("never calls Foursquare when nothing is thin, even if it's available", () => {
		const plan = planLiveTopUp(coverage(), false, true);
		expect(plan.willCallFoursquare).toBe(false);
	});

	it("totalCalls is exactly the number of real outbound calls this plan will fire (budget honesty)", () => {
		// All four categories thin, both extra sources available: 4 Google
		// category calls + 1 Viator + 1 Foursquare = 6. The daily fetch
		// budget increments by this number, not a flat 1 -- getting this
		// wrong previously undercounted real Google API cost by ~3x.
		const plan = planLiveTopUp(
			coverage({ food: 0, accommodation: 0, activity: 0, transport: 0 }),
			true,
			true,
		);
		expect(plan.thinCategories).toHaveLength(4);
		expect(plan.totalCalls).toBe(4 + 1 + 1);
	});

	it("totalCalls is zero when nothing is thin, even if both extra sources are available", () => {
		const plan = planLiveTopUp(coverage(), true, true);
		expect(plan.totalCalls).toBe(0);
	});
});
