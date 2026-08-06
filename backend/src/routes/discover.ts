import { Router, Request, Response } from "express";
import { getDiscoveryDestinations, getSpotlightPlaces } from "../services/discovery";

export const discoverRouter = Router();

// GET /api/v1/discover/destinations
// Replaces the old hardcoded destination pill list. Two live-computed
// tiers, never hand-picked -- see discovery.ts for the eligibility bars.
discoverRouter.get("/destinations", async (_req: Request, res: Response) => {
	try {
		const destinations = await getDiscoveryDestinations();
		return res.json(destinations);
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// GET /api/v1/discover/spotlight
// Small editorial preview for the unscoped Explore screen -- explicitly
// NOT a "For you" feed (no personalization score, no single unscoped
// query that lets one deep destination's row count dominate).
discoverRouter.get("/spotlight", async (_req: Request, res: Response) => {
	try {
		const { featured } = await getDiscoveryDestinations();
		const regions = featured.slice(0, 3).map((d) => d.region);
		const places = await getSpotlightPlaces(regions, 2);
		return res.json({ results: places });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});
