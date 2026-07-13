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

// --- Stage 2: social proof + learned affinities ---
import {
  socialScore,
  affinityMatch,
  MAX_SOCIAL_SCORE,
  AFFINITY_MIN_INTERACTIONS,
} from "../src/services/recommendations";
import { mapPriceLevelV1 } from "../src/services/googlePlaces";

describe("socialScore", () => {
  it("is 0 with no community signal", () => {
    expect(socialScore(undefined)).toBe(0);
    expect(socialScore({ weighted: 0, saves: 0, books: 0 })).toBe(0);
  });

  it("grows with interest and caps at MAX_SOCIAL_SCORE", () => {
    const few = socialScore({ weighted: 3, saves: 1, books: 0 });
    const many = socialScore({ weighted: 300, saves: 60, books: 20 });
    expect(few).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(few);
    expect(many).toBeLessThanOrEqual(MAX_SOCIAL_SCORE);
  });

  it("community interest breaks ties between otherwise equal places", () => {
    const mk = (weighted: number) => {
      const b = scoreOperator(
        { category: "activity", tags: ["scuba_diving"], rating: 4.5,
          review_count: 100, price_level: 2, region: "nusa penida" },
        basePrefs, "nusa penida", { weighted, saves: weighted, books: 0 },
      );
      return total(b);
    };
    expect(mk(50)).toBeGreaterThan(mk(0));
  });
});

describe("affinityMatch / behaviour blending", () => {
  const diveAffinity = {
    totalInteractions: 10,
    tags: { scuba_diving: 1.0, diving: 0.8 },
  };

  it("ignores behaviour below the cold-start threshold", () => {
    const coldStart = { totalInteractions: AFFINITY_MIN_INTERACTIONS - 1, tags: { scuba_diving: 1.0 } };
    expect(affinityMatch(["scuba_diving"], coldStart)).toBe(0);
  });

  it("behaviour outweighs onboarding once history exists (Executive decision)", () => {
    // User whose onboarding says hiking only, but who keeps booking dive trips
    const hikerPrefs = { ...basePrefs, water_activities: [], land_activities: ["hiking"] };
    const diveShop = {
      category: "activity", tags: ["scuba_diving"], rating: 4.5,
      review_count: 100, price_level: 2, region: "nusa penida",
    };
    const withoutHistory = scoreOperator(diveShop, hikerPrefs, "nusa penida").activity;
    const withHistory = scoreOperator(diveShop, hikerPrefs, "nusa penida", undefined, diveAffinity).activity;
    expect(withoutHistory).toBe(0); // pure prefs: no match
    expect(withHistory).toBeGreaterThanOrEqual(15); // behaviour dominates (60% weight)
  });

  it("dietary requirements are not diluted by behaviour", () => {
    const steakhouse = {
      category: "food", tags: ["steakhouse"], rating: 4.5,
      review_count: 100, price_level: 2, region: "canggu",
    };
    const steakAffinity = { totalInteractions: 20, tags: { steakhouse: 1.0 } };
    const b = scoreOperator(steakhouse, basePrefs, "canggu", undefined, steakAffinity);
    // vegan user: affinity bonus (≤6) cannot fake dietary fit (0 base)
    expect(b.dietary).toBeLessThanOrEqual(6);
  });
});

describe("mapPriceLevelV1", () => {
  it("maps v1 enums to numeric levels", () => {
    expect(mapPriceLevelV1("PRICE_LEVEL_INEXPENSIVE")).toBe(1);
    expect(mapPriceLevelV1("PRICE_LEVEL_MODERATE")).toBe(2);
    expect(mapPriceLevelV1("PRICE_LEVEL_EXPENSIVE")).toBe(3);
    expect(mapPriceLevelV1("PRICE_LEVEL_VERY_EXPENSIVE")).toBe(4);
    expect(mapPriceLevelV1(undefined)).toBeNull();
  });
});
