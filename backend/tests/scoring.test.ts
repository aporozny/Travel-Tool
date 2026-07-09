/**
 * P5 — Scoring test suite (Stage 1, Drift Discovery Engine).
 * Locks ranking behaviour: Bayesian rating math, category-aware personal fit,
 * capped tier bonus, and ordering invariants.
 */
import {
	bayesianRating,
	scoreOperator,
	BAYES_PRIOR,
	MAX_TIER_BONUS,
} from "../src/services/recommendations";

// Redis/pg are imported transitively by recommendations.ts — mock them so
// tests need no live services.
jest.mock("../src/utils/db", () => ({ pool: { query: jest.fn() } }));
jest.mock("../src/utils/redis", () => ({
	redis: { get: jest.fn(), setex: jest.fn(), keys: jest.fn(), del: jest.fn() },
}));

const basePrefs: any = {
	travel_style: [],
	budget_range: "mid",
	accommodation_budget_aud: "",
	splurge_categories: [],
	accommodation_types: ["hostel"],
	accommodation_must_haves: ["fast_wifi", "kitchen"],
	dietary_requirements: ["vegan"],
	food_adventurousness: "",
	cuisine_preferences: [],
	dining_style: "",
	water_activities: ["scuba_diving"],
	land_activities: ["hiking"],
	wellness_interests: [],
	cultural_interests: ["food_tours"],
	nightlife_preference: "",
	adrenaline_level: "",
	nature_interests: [],
	sustainability_commitment: "",
	fitness_level: "",
	regions_visited: [],
	bucket_list_regions: [],
	bali_areas_interest: [],
	next_trip_timing: "planning_now",
	onboarding_completed: true,
};

const total = (b: Record<string, number>) =>
	Object.values(b).reduce((s, v) => s + v, 0);

describe("bayesianRating", () => {
	it("pulls a low-volume perfect score toward the prior", () => {
		const oneReview = bayesianRating(5.0, 1);
		expect(oneReview).toBeLessThan(4.0);
		expect(oneReview).toBeGreaterThan(BAYES_PRIOR - 0.1);
	});

	it("lets volume earn the rating back", () => {
		expect(bayesianRating(4.7, 2000)).toBeGreaterThan(4.6);
	});

	it("5.0×1 review ranks below 4.7×2000 reviews", () => {
		expect(bayesianRating(5.0, 1)).toBeLessThan(bayesianRating(4.7, 2000));
	});

	it("handles unrated items without NaN", () => {
		expect(bayesianRating(0, 0)).toBeCloseTo(BAYES_PRIOR * 0.9, 5);
		expect(Number.isNaN(bayesianRating(null as any, undefined as any))).toBe(
			false,
		);
	});
});

describe("scoreOperator — category awareness", () => {
	it("does not score a dive shop on dietary tags", () => {
		const diveShop = {
			category: "activity",
			tags: ["scuba_diving"],
			rating: 4.5,
			review_count: 100,
			price_level: 2,
			region: "nusa penida",
		};
		const b = scoreOperator(diveShop, basePrefs, "nusa penida");
		expect(b.dietary).toBe(0);
		expect(b.accommodation).toBe(0);
		expect(b.activity).toBeGreaterThan(0);
	});

	it("scores food on dietary fit, not activity tags", () => {
		const veganCafe = {
			category: "food",
			tags: ["vegan", "cafe"],
			rating: 4.5,
			review_count: 100,
			price_level: 2,
			region: "canggu",
		};
		const b = scoreOperator(veganCafe, basePrefs, "canggu");
		expect(b.dietary).toBeGreaterThan(0);
		expect(b.activity).toBe(0);
	});

	it("a vegan cafe outranks a non-vegan restaurant for a vegan user, all else equal", () => {
		const mk = (tags: string[]) => ({
			category: "food",
			tags,
			rating: 4.5,
			review_count: 100,
			price_level: 2,
			region: "canggu",
		});
		const vegan = total(scoreOperator(mk(["vegan"]), basePrefs, "canggu"));
		const steak = total(scoreOperator(mk(["steakhouse"]), basePrefs, "canggu"));
		expect(vegan).toBeGreaterThan(steak);
	});

	it("scores accommodation on type + must-haves", () => {
		const hostel = {
			category: "accommodation",
			tags: ["hostel", "fast_wifi", "kitchen"],
			rating: 4.3,
			review_count: 200,
			price_level: 1,
			region: "ubud",
		};
		const b = scoreOperator(hostel, basePrefs, "ubud");
		expect(b.accommodation).toBe(30); // 20 type + 10 for 2/2 must-haves
		expect(b.dietary).toBe(0);
	});
});

describe("scoreOperator — quality and volume", () => {
	const mk = (rating: number, review_count: number) => ({
		category: "activity",
		tags: ["scuba_diving"],
		rating,
		review_count,
		price_level: 2,
		region: "nusa penida",
	});

	it("review volume beats a hollow perfect rating", () => {
		const hollow = total(scoreOperator(mk(5.0, 1), basePrefs, "nusa penida"));
		const proven = total(
			scoreOperator(mk(4.7, 2000), basePrefs, "nusa penida"),
		);
		expect(proven).toBeGreaterThan(hollow);
	});
});

describe("scoreOperator — tier bonus cap", () => {
	const mk = (extra: object) => ({
		category: "activity",
		tags: ["scuba_diving"],
		rating: 4.5,
		review_count: 100,
		price_level: 2,
		region: "nusa penida",
		...extra,
	});

	it(`verified bonus never exceeds ${MAX_TIER_BONUS}`, () => {
		const b = scoreOperator(
			mk({ is_verified: true }),
			basePrefs,
			"nusa penida",
		);
		expect(b.claimed_bonus).toBeLessThanOrEqual(MAX_TIER_BONUS);
	});

	it("a verified mediocre operator cannot outrank an excellent unverified one", () => {
		const verifiedMediocre = total(
			scoreOperator(
				{
					category: "activity",
					tags: [],
					rating: 3.2,
					review_count: 20,
					price_level: 2,
					region: "nusa penida",
					is_verified: true,
				},
				basePrefs,
				"nusa penida",
			),
		);
		const unverifiedExcellent = total(
			scoreOperator(
				{
					category: "activity",
					tags: ["scuba_diving", "hiking"],
					rating: 4.9,
					review_count: 800,
					price_level: 2,
					region: "nusa penida",
				},
				basePrefs,
				"nusa penida",
			),
		);
		expect(unverifiedExcellent).toBeGreaterThan(verifiedMediocre);
	});
});

describe("scoreOperator — score bounds", () => {
	it("total stays within 0–100", () => {
		const maxed = {
			category: "accommodation",
			tags: ["hostel", "fast_wifi", "kitchen"],
			rating: 5.0,
			review_count: 100000,
			price_level: 1,
			region: "ubud",
			is_verified: true,
		};
		const t = total(scoreOperator(maxed, basePrefs, "ubud"));
		expect(t).toBeGreaterThan(0);
		expect(t).toBeLessThanOrEqual(100);
	});
});
