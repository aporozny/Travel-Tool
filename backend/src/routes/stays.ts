import { Router, Response } from "express";
import { z } from "zod";
import { DuffelError } from "@duffel/api";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { searchStays, fetchStaysRates, type StaysAccommodationView } from "../services/stays";
import { searchTravelportStays } from "../services/travelportStays";
import { startTripgicStaysSearch, getTripgicStaysState, isValidSearchId } from "../services/tripgicStays";

export const staysRouter = Router();

// Duffel's own validation errors have a clear human-readable message --
// surface that instead of a generic 500, same pattern as flights.ts.
function respondToDuffelError(err: unknown, res: Response): boolean {
	if (!(err instanceof DuffelError)) return false;
	// err.errors is typed as always present, but can be undefined at
	// runtime -- indexing it directly crashed the whole process (confirmed
	// live), since this runs inside a route's catch block with nothing
	// further to catch it. It's specifically undefined for Duffel's
	// "feature not enabled for your account" 403 (confirmed live via raw
	// curl, 2026-08-24: Stays isn't turned on for this account yet --
	// see RISK-REGISTER.md R12/STAGE-PLAN-11.md) -- that response is
	// plain text, not Duffel's normal {meta, errors} JSON envelope, so
	// nothing in `err` captures it; the fallback message below covers it.
	const first = err.errors?.[0];
	console.error("Duffel API error:", err.message, err.meta, err.errors);
	res.status(422).json({
		message: first?.message ?? "Stays search failed -- this Duffel account may not have Stays access enabled yet (contact Duffel sales)",
		code: first?.code,
	});
	return true;
}

const searchSchema = z.object({
	destination: z.string().min(1),
	checkInDate: z.string().date(),
	checkOutDate: z.string().date(),
	rooms: z.number().int().min(1).max(8).default(1),
	adults: z.number().int().min(1).max(16).default(1),
});

// POST /api/v1/stays/search
// Search/browse only -- no booking. Duffel Stays is currently blocked
// (403, "not enabled for your account" -- see RISK-REGISTER R15), so
// unlike flights.ts, Duffel is treated as tolerant here too, not just
// Travelport: whichever provider succeeds is returned, and this only
// fails if BOTH do (in which case the more informative of the two errors
// -- e.g. a bad destination name -- is what gets surfaced below).
staysRouter.post("/search", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = searchSchema.parse(req.body);
		const [duffelResult, travelportResult] = await Promise.allSettled([
			searchStays(body),
			searchTravelportStays(body),
		]);

		// Log both outcomes before deciding what to do with them -- logging
		// only in the "at least one succeeded" branch meant a double failure
		// threw silently with no record of what Travelport's side actually
		// said (found live while debugging exactly that).
		if (duffelResult.status === "rejected") {
			console.error("Duffel stays search failed:", duffelResult.reason);
		}
		if (travelportResult.status === "rejected") {
			console.error("Travelport stays search failed:", travelportResult.reason);
		}

		let results: StaysAccommodationView[] = [];
		if (duffelResult.status === "fulfilled") results = results.concat(duffelResult.value);
		if (travelportResult.status === "fulfilled") results = results.concat(travelportResult.value);

		if (results.length === 0) {
			throw duffelResult.status === "rejected" ? duffelResult.reason : (travelportResult as PromiseRejectedResult).reason;
		}

		return res.json({ results });
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		if (err instanceof Error && err.message.includes("not configured")) {
			return res.status(503).json({ message: "Stays search is not yet available" });
		}
		if (err instanceof Error && err.message.includes("Could not find a location")) {
			return res.status(400).json({ message: err.message });
		}
		if (respondToDuffelError(err, res)) return;
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// POST /api/v1/stays/tripgic-search
// TripGic hotel search takes ~40s upstream, so it can't ride along in
// /search above -- that would hold every other provider's results back
// for the slowest one. This starts (or joins) a background job and
// returns straight away; the client polls the GET below. A search that
// was already run in the last 30 minutes comes back ready immediately.
staysRouter.post("/tripgic-search", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = searchSchema.parse(req.body);
		const { searchId } = await startTripgicStaysSearch(body);
		const state = await getTripgicStaysState(searchId);
		return res.json({ searchId, ...state });
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		if (err instanceof Error && err.message.includes("not configured")) {
			return res.status(503).json({ message: "Extended hotel search is not yet available" });
		}
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// GET /api/v1/stays/tripgic-search/:searchId
// Poll target for the job above: pending | ready | failed | unknown
// ("unknown" = never started, or expired -- the client just searches again).
// Registered before /:searchResultId/rates so "tripgic-search" is never
// read as a search result id.
staysRouter.get("/tripgic-search/:searchId", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		if (!isValidSearchId(req.params.searchId)) return res.status(400).json({ message: "Invalid search id" });
		return res.json(await getTripgicStaysState(req.params.searchId));
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// GET /api/v1/stays/:searchResultId/rates
// Full room/rate breakdown for one property from a search -- not a
// booking step, just the detail view a traveler sees before deciding.
staysRouter.get("/:searchResultId/rates", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const rates = await fetchStaysRates(req.params.searchResultId);
		return res.json({ rates });
	} catch (err) {
		if (err instanceof Error && err.message.includes("not configured")) {
			return res.status(503).json({ message: "Stays search is not yet available" });
		}
		if (respondToDuffelError(err, res)) return;
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});
