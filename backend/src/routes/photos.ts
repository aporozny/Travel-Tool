import { Router, Request, Response } from "express";
import { fetchPhotoBuffer, refreshPlacePhotos } from "../services/googlePlaces";
import { redis } from "../utils/redis";
import { pool } from "../utils/db";

export const photosRouter = Router();

// Find the Google place id that owns a photo ref. v1 refs embed it;
// legacy refs need a catalog lookup.
async function resolvePlaceId(ref: string): Promise<string | null> {
	if (ref.startsWith("places/")) return ref.split("/")[1] || null;
	const r = await pool.query(
		`SELECT external_id FROM places_cache WHERE photos::text LIKE $1 LIMIT 1`,
		[`%${ref.slice(0, 100)}%`],
	);
	return r.rows[0]?.external_id || null;
}

// GET /api/v1/photos?ref=<photo_reference>&w=800
// Proxies Google Place photos without exposing API key
photosRouter.get("/", async (req: Request, res: Response) => {
	const { ref, w } = req.query;

	if (!ref || typeof ref !== "string") {
		return res.status(400).json({ message: "Photo reference required" });
	}

	// Validate ref format - Google photo refs are alphanumeric + hyphens/underscores
	const decodedRef = decodeURIComponent(ref);
	if (!/^[A-Za-z0-9_\-\/]+$/.test(decodedRef)) {
		return res.status(400).json({ message: "Invalid photo reference" });
	}

	const maxWidth = Math.min(parseInt(w as string) || 800, 1600);

	try {
		// Cache photo in Redis for 24h to avoid hammering Google
		const cacheKey = `photo:${decodedRef}:${maxWidth}`;
		const cached = await redis.getBuffer(cacheKey);

		if (cached) {
			res.set("Content-Type", "image/jpeg");
			res.set("Cache-Control", "public, max-age=86400");
			return res.send(cached);
		}

		let data: Buffer;
		let contentType: string;
		try {
			({ data, contentType } = await fetchPhotoBuffer(decodedRef, maxWidth));
		} catch (err: any) {
			// Google photo names expire before our catalog TTL. On a stale ref,
			// re-resolve fresh names from the place and heal the catalog row.
			if (err?.response?.status !== 400) throw err;
			const placeId = await resolvePlaceId(decodedRef);
			if (!placeId) throw err;
			const fresh = await refreshPlacePhotos(placeId);
			if (fresh.length === 0) throw err;
			await pool.query(
				`UPDATE places_cache SET photos = $1, updated_at = NOW() WHERE external_id = $2`,
				[JSON.stringify(fresh), placeId],
			);
			({ data, contentType } = await fetchPhotoBuffer(fresh[0], maxWidth));
		}

		// Cache for 24 hours (under the requested ref, so repeat requests for a
		// stale ref are served from cache without re-resolving)
		await redis.setex(cacheKey, 86400, data);

		res.set("Content-Type", contentType);
		res.set("Cache-Control", "public, max-age=86400");
		return res.send(data);
	} catch (err) {
		console.error("Photo proxy error:", err);
		return res.status(502).json({ message: "Could not fetch photo" });
	}
});
