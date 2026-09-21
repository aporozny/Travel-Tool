import { Router, Request, Response } from "express";
import { z } from "zod";
import {
	search,
	getPlaceById,
	enrichPlace,
	getSubregions,
} from "../services/searchCache";
import { geocodeDestination } from "../services/geocoding";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { submitClaim, listOwnClaims, reviewClaim, ClaimError } from "../services/listingClaims";

export const searchRouter = Router();

const searchSchema = z.object({
	// Empty q = browse mode: all places near the destination, no text filter
	q: z.string().max(200).optional().default(""),
	region: z.string().default("Bali"),
	category: z
		.enum(["food", "accommodation", "activity", "transport"])
		.optional(),
	limit: z.coerce.number().int().min(1).max(50).default(20),
	sub_area: z.string().optional(),
});

// GET /api/v1/search?q=diving&region=nusa-penida&category=activity
searchRouter.get("/", async (req: Request, res: Response) => {
	try {
		const params = searchSchema.parse(req.query);

		const { results, source, total, geo } = await search(
			params.q,
			params.region,
			params.category,
			params.limit,
			params.sub_area,
		);

		return res.json({
			query: params.q,
			region: params.region,
			geo,
			category: params.category || null,
			sub_area: params.sub_area || null,
			source,
			total,
			results,
		});
	} catch (err) {
		if (err instanceof z.ZodError) {
			return res
				.status(400)
				.json({ message: "Validation error", errors: err.errors });
		}
		console.error(err);
		return res.status(500).json({ message: "Search failed" });
	}
});

// GET /api/v1/search/geocode?address=... — resolve a free-text address to
// coordinates, for the "can't find it? add it" place-creation flow
// (member-sourced places, Stage 13). Thin wrapper over the same
// geocodeDestination() that already powers region search — no new Google
// key/quota, same 90-day cache.
searchRouter.get("/geocode", async (req: Request, res: Response) => {
	try {
		const address = z.string().min(1).max(200).parse(req.query.address);
		const result = await geocodeDestination(address);
		if (!result) {
			return res.status(404).json({ message: "Could not resolve that location" });
		}
		return res.json({
			latitude: result.latitude,
			longitude: result.longitude,
			name: result.name,
			country: result.country,
		});
	} catch (err) {
		if (err instanceof z.ZodError) {
			return res
				.status(400)
				.json({ message: "Validation error", errors: err.errors });
		}
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// GET /api/v1/search/subregions?region=Singapore - neighborhoods/suburbs
// worth offering for this destination, gated by precomputed coverage.
searchRouter.get("/subregions", async (req: Request, res: Response) => {
	try {
		const region = z.string().min(1).max(200).parse(req.query.region);
		const subregions = await getSubregions(region);
		return res.json({ region, subregions });
	} catch (err) {
		if (err instanceof z.ZodError) {
			return res
				.status(400)
				.json({ message: "Validation error", errors: err.errors });
		}
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// GET /api/v1/search/places/:id - get single place with full details
searchRouter.get("/places/:id", async (req: Request, res: Response) => {
	try {
		const place = await getPlaceById(req.params.id);
		if (!place) return res.status(404).json({ message: "Place not found" });

		// Enrich in background if phone/website missing -- never for
		// member-sourced places (Stage 13): their external_id is a synthetic
		// "member:<uuid>" value, not a real Google place ID, so this would
		// otherwise burn a real Google API call every single view that can
		// never succeed, log an error, and never actually enrich anything.
		if ((!place.phone || !place.website) && place.source !== "member") {
			enrichPlace(place.id, place.external_id).catch(() => {});
		}

		return res.json(place);
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// POST /api/v1/search/places/:id/claim - operator claims a listing
// (same rules as POST /operators/claims: both call services/listingClaims.ts)
searchRouter.post(
	"/places/:id/claim",
	authenticate,
	async (req: AuthenticatedRequest, res: Response) => {
		try {
			if (req.user!.role !== "operator") {
				return res
					.status(403)
					.json({ message: "Only operators can claim listings" });
			}

			const evidence =
				typeof req.body?.evidence === "string" ? req.body.evidence.slice(0, 2000) : null;

			const claim = await submitClaim({
				userId: req.user!.id,
				placeId: req.params.id,
				evidence,
			});

			return res.status(201).json({
				claim_id: claim.claimId,
				status: claim.status,
				message: "Claim submitted. You will be notified once reviewed.",
			});
		} catch (err) {
			if (err instanceof ClaimError) {
				return res.status(err.status).json({ message: err.message });
			}
			console.error(err);
			return res.status(500).json({ message: "Internal server error" });
		}
	},
);

// GET /api/v1/search/claims - operator views their own claims
searchRouter.get(
	"/claims",
	authenticate,
	async (req: AuthenticatedRequest, res: Response) => {
		try {
			if (req.user!.role !== "operator") {
				return res.status(403).json({ message: "Operators only" });
			}
			return res.json(await listOwnClaims(req.user!.id));
		} catch (err) {
			console.error(err);
			return res.status(500).json({ message: "Internal server error" });
		}
	},
);

// PATCH /api/v1/search/claims/:id - admin approves/rejects claim
searchRouter.patch(
	"/claims/:id",
	authenticate,
	async (req: AuthenticatedRequest, res: Response) => {
		try {
			if (req.user!.role !== "admin") {
				return res.status(403).json({ message: "Admin only" });
			}

			const { status } = z
				.object({ status: z.enum(["approved", "rejected"]) })
				.parse(req.body);

			const result = await reviewClaim(req.params.id, req.user!.id, status);
			return res.json({ id: result.claimId, status: result.status });
		} catch (err) {
			if (err instanceof z.ZodError) {
				return res
					.status(400)
					.json({ message: "Validation error", errors: err.errors });
			}
			if (err instanceof ClaimError) {
				return res.status(err.status).json({ message: err.message });
			}
			console.error(err);
			return res.status(500).json({ message: "Internal server error" });
		}
	},
);
