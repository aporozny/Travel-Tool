import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { searchFlights } from "../services/flights";

export const flightsRouter = Router();

const searchSchema = z.object({
	origin: z.string().length(3).toUpperCase(),
	destination: z.string().length(3).toUpperCase(),
	departureDate: z.string().date(),
	returnDate: z.string().date().optional(),
	adults: z.number().int().min(1).max(9).default(1),
	cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional(),
});

// POST /api/v1/flights/search
// Ships inactive: searchFlights() throws a clear "not configured" error
// (surfaced here as 503) until DUFFEL_API_KEY is set, same fail-closed
// default as every other credential-gated route in this codebase.
flightsRouter.post("/search", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	try {
		const body = searchSchema.parse(req.body);
		const offers = await searchFlights(body);
		return res.json({ offers });
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		if (err instanceof Error && err.message.includes("not configured")) {
			return res.status(503).json({ message: "Flight search is not yet available" });
		}
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});
