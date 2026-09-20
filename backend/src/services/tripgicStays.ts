import crypto from "crypto";
import { redis } from "../utils/redis";
import { tripgicPost } from "../utils/tripgicClient";
import type { StaysSearchParams, StaysAccommodationView } from "./stays";
import { getActiveMarkupRule, computeMarkup, type MarkupRule } from "./flights";

// TripGic hotel search, alongside Travelport/Duffel Stays -- browse only,
// no booking, no markup (same posture as the other providers on this
// screen). See tripgicClient.ts for auth.
//
// The thing that shapes this whole file: TripGic's POST /hotel/search takes
// ~40 seconds (their own sample says 42s; measured 38-42s live, and
// limiting supplier_uid or radius did NOT speed it up -- both tested,
// 2026-09-19). Running that inline would freeze the Stays tab and any
// request timeout in front of it, so a search is a background job: the
// start call returns immediately, the result lands in Redis, and the
// frontend polls. Identical searches share one job (the search id is a
// hash of the parameters) and a finished result is served from cache for
// 30 minutes, so repeating a search -- e.g. a demo re-run -- is instant.
//
// Confirmed against the live sandbox rather than assumed:
// - A search returns one row per property (its cheapest room), ~750 for
//   Seminyak, ~1.2MB. Only the cheapest MAX_RESULTS are kept and returned.
// - Prices are quoted in the account base currency (USD in the sandbox,
//   no request-side override), same caveat as flights.
// - "No hotels found" comes back as status "failed"; that maps to an empty
//   result, not an error.
// - The location must be a string TripGic recognises. /hotel/auto-suggetion
//   (sic) resolves free text to one, but rejects anything under 5
//   characters, in which case the raw destination is tried as-is.

const MAX_RESULTS = 100;
const RESULT_TTL_SECONDS = 30 * 60;
const PENDING_TTL_SECONDS = 180;
const ERROR_TTL_SECONDS = 5 * 60;
const SEARCH_TIMEOUT_MS = 120000;

// Placeholder until the search carries the traveller's own nationality --
// TripGic uses it for rate eligibility. Drift's launch market is Australia.
const DEFAULT_GUEST_NATIONALITY = "AU";

interface TripgicHotelRow {
	hotel_id: string;
	room_tracking_id: string;
	hotel_name: string;
	property_type?: string;
	star_rating?: number | null;
	primary_photo?: string | null;
	address?: string;
	latitude?: string | number | null;
	longitude?: string | number | null;
	currency: string;
	total_amount: number;
	facility?: { title: string }[];
}

interface TripgicHotelSearchResponse {
	status: string;
	reason?: string | null;
	data?: TripgicHotelRow[];
}

export type TripgicStaysState =
	| { status: "pending" }
	| { status: "ready"; results: StaysAccommodationView[]; totalFound: number }
	| { status: "failed"; message: string }
	| { status: "unknown" };

const keys = (searchId: string) => ({
	result: `tripgic:stays:${searchId}:result`,
	pending: `tripgic:stays:${searchId}:pending`,
	error: `tripgic:stays:${searchId}:error`,
});

export function isValidSearchId(value: string): boolean {
	return /^[a-f0-9]{16}$/.test(value);
}

function searchIdFor(params: StaysSearchParams): string {
	// "v2": results are cached with markup baked in, so entries written
	// before markup was applied must not be served.
	const canonical = JSON.stringify([
		"v2",
		params.destination.trim().toLowerCase(),
		params.checkInDate,
		params.checkOutDate,
		params.rooms,
		params.adults,
	]);
	return crypto.createHash("sha1").update(canonical).digest("hex").slice(0, 16);
}

function requireConfigured(): void {
	for (const name of ["TRIPGIC_API_ENDPOINT", "TRIPGIC_API_KEY", "TRIPGIC_SECRET_CODE", "TRIPGIC_PARTNER_ID"]) {
		if (!process.env[name]) throw new Error(`${name} not configured -- TripGic hotel search is inactive`);
	}
}

// Drift's search takes total adults + rooms; TripGic takes adults per room.
// Spread adults evenly, never more rooms than adults (an empty room isn't valid).
export function buildOccupancies(rooms: number, adults: number): { adult: string }[] {
	const roomCount = Math.max(1, Math.min(rooms, adults));
	const base = Math.floor(adults / roomCount);
	const remainder = adults % roomCount;
	return Array.from({ length: roomCount }, (_, i) => ({ adult: String(base + (i < remainder ? 1 : 0)) }));
}

async function resolveLocation(destination: string): Promise<string> {
	try {
		const suggestions = await tripgicPost<{ location?: string }[] | { status?: string }>("/hotel/auto-suggetion", { location: destination });
		if (Array.isArray(suggestions) && suggestions[0]?.location) return suggestions[0].location;
	} catch {
		// fall through to the raw destination
	}
	return destination;
}

// "Jl. Camplung Tanduk, No. 24,Seminyak,ID" -> city "Seminyak", country "ID".
// The address is free text, so anything that doesn't look like that falls
// back to the searched destination rather than guessing.
function cityAndCountry(address: string | undefined, fallbackCity: string): { cityName: string; countryCode: string } {
	const parts = (address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
	const last = parts[parts.length - 1] ?? "";
	if (/^[A-Z]{2}$/.test(last) && parts.length >= 2) {
		return { cityName: parts[parts.length - 2], countryCode: last };
	}
	return { cityName: fallbackCity, countryCode: "" };
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
	if (value == null || value === "") return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function toAccommodationView(row: TripgicHotelRow, destination: string, rule: MarkupRule): StaysAccommodationView {
	const { cityName, countryCode } = cityAndCountry(row.address, destination);
	// Marked-up, so the price on the card is the price the traveller books at.
	const charged = Math.round(computeMarkup(row.total_amount, rule).totalAmount * 100) / 100;
	return {
		id: row.room_tracking_id,
		accommodationId: row.hotel_id,
		name: row.hotel_name,
		cityName,
		countryCode,
		rating: row.star_rating ?? null,
		// TripGic's rating_average is populated for only ~10% of properties and
		// its scale isn't documented, so it isn't mapped rather than guessed at.
		reviewScore: null,
		reviewCount: null,
		photoUrls: row.primary_photo ? [row.primary_photo] : [],
		amenityTypes: Array.from(new Set((row.facility ?? []).map((f) => f.title))).slice(0, 12),
		cheapestRateTotalAmount: charged.toFixed(2),
		cheapestRateCurrency: row.currency,
		latitude: toNumberOrNull(row.latitude),
		longitude: toNumberOrNull(row.longitude),
		provider: "tripgic",
	};
}

async function runSearch(searchId: string, params: StaysSearchParams): Promise<void> {
	const k = keys(searchId);
	try {
		const location = await resolveLocation(params.destination);
		const response = await tripgicPost<TripgicHotelSearchResponse>(
			"/hotel/search",
			{
				location,
				partner_id: process.env.TRIPGIC_PARTNER_ID,
				guest_nationality: DEFAULT_GUEST_NATIONALITY,
				checkIn: params.checkInDate,
				checkOut: params.checkOutDate,
				radius: "auto",
				breakfast_option: "any",
				hotel_star_level: "any",
				search_currency: "any",
				language: "en",
				occupancies: buildOccupancies(params.rooms, params.adults),
			},
			{ timeoutMs: SEARCH_TIMEOUT_MS },
		);

		let rows: TripgicHotelRow[] = [];
		if (response.status === "success") {
			rows = response.data ?? [];
		} else if (!/no hotels found/i.test(response.reason ?? "")) {
			throw new Error(`TripGic hotel search failed: ${response.reason ?? "unknown reason"}`);
		}

		const priced = rows.filter((r) => Number.isFinite(r.total_amount) && r.total_amount > 0);
		priced.sort((a, b) => a.total_amount - b.total_amount);
		const rule = await getActiveMarkupRule();
		const results = priced.slice(0, MAX_RESULTS).map((r) => toAccommodationView(r, params.destination, rule));

		await redis.set(k.result, JSON.stringify({ results, totalFound: priced.length }), "EX", RESULT_TTL_SECONDS);
	} catch (err) {
		console.error("TripGic hotel search failed:", err);
		await redis.set(k.error, "Could not load these hotels right now.", "EX", ERROR_TTL_SECONDS);
	} finally {
		await redis.del(k.pending);
	}
}

// Kicks off (or joins) the background search and returns immediately.
// Throws a "not configured" error synchronously so the route can 503
// instead of starting a job that can only fail.
export async function startTripgicStaysSearch(params: StaysSearchParams): Promise<{ searchId: string }> {
	requireConfigured();
	const searchId = searchIdFor(params);
	const k = keys(searchId);

	if (await redis.exists(k.result)) return { searchId };

	const claimed = await redis.set(k.pending, "1", "EX", PENDING_TTL_SECONDS, "NX");
	if (claimed) {
		await redis.del(k.error);
		void runSearch(searchId, params);
	}
	return { searchId };
}

export async function getTripgicStaysState(searchId: string): Promise<TripgicStaysState> {
	const k = keys(searchId);
	const cached = await redis.get(k.result);
	if (cached) {
		const parsed = JSON.parse(cached) as { results: StaysAccommodationView[]; totalFound: number };
		return { status: "ready", results: parsed.results, totalFound: parsed.totalFound };
	}
	if (await redis.exists(k.pending)) return { status: "pending" };
	const error = await redis.get(k.error);
	if (error) return { status: "failed", message: error };
	return { status: "unknown" };
}
