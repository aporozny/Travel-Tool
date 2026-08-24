import { Router, Response } from "express";
import { z } from "zod";
import { DuffelError } from "@duffel/api";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { searchStays, fetchStaysRates } from "../services/stays";

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
// Search/browse only -- no booking. Ships inactive: throws a clear
// "not configured" error (surfaced here as 503) until DUFFEL_API_KEY is
// set, same fail-closed pattern as flights.ts.
staysRouter.post("/search", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = searchSchema.parse(req.body);
		const results = await searchStays(body);
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
