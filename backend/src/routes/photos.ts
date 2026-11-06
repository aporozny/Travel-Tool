import { Router, Request, Response } from "express";
import { fetchPhotoBuffer, refreshPlacePhotos } from "../services/googlePlaces";
import { redis } from "../utils/redis";
import { pool } from "../utils/db";

export const photosRouter = Router();

// Find the Google place id that owns a photo ref. v1 refs embed it;
// legacy refs need a catalog lookup.
async function resolvePlace(
	ref: string,
): Promise<{ placeId: string; index: number } | null> {
	const r = await pool.query(
		`SELECT external_id, photos FROM places_cache WHERE photos::text LIKE $1 LIMIT 1`,
		[`%${ref.slice(0, 100)}%`],
	);
	const row = r.rows[0];
	const old: string[] = Array.isArray(row?.photos)
		? row.photos
		: row?.photos
			? JSON.parse(row.photos)
			: [];
	const index = Math.max(0, old.indexOf(ref));
	if (ref.startsWith("places/")) {
		const placeId = ref.split("/")[1];
		return placeId ? { placeId, index } : null;
	}
	return row ? { placeId: row.external_id, index } : null;
}

// Google answers an expired or unknown photo name with 400 (legacy) or 404 (v1).
// Anything else (403 key/billing/API disabled, 429 quota, 5xx) is NOT stale and
// must not trigger a catalog rewrite.
const isStaleRefError = (err: any) =>
	err?.response?.status === 400 || err?.response?.status === 404;

// GET /api/v1/photos?ref=<photo_reference>&w=800
// Proxies Google Place photos without exposing API key
photosRouter.get("/", async (req: Request, res: Response) => {
	const { ref, w } = req.query;

	if (!ref || typeof ref !== "string") {
		return res.status(400).json({ message: "Photo reference required" });
	}

	// Validate ref format - Google photo refs are alphanumeric + hyphens/underscores
	// Express has already decoded the query string once, so a literal "%" (for
	// example ?ref=%25) reaches here as a lone "%" and decodeURIComponent throws
	// URIError. In an async Express 4 handler that is an unhandled rejection, which
	// Node 20 treats as fatal: one unauthenticated request took the whole API down.
	let decodedRef: string;
	try {
		decodedRef = decodeURIComponent(ref);
	} catch {
		return res.status(400).json({ message: "Invalid photo reference" });
	}
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
			if (!isStaleRefError(err)) throw err;
			const place = await resolvePlace(decodedRef);
			if (!place) throw err;
			const { placeId, index } = place;
			const fresh = await refreshPlacePhotos(placeId);
			if (fresh.length === 0) throw err;
			await pool.query(
				`UPDATE places_cache SET photos = $1, updated_at = NOW() WHERE external_id = $2`,
				[JSON.stringify(fresh), placeId],
			);
			({ data, contentType } = await fetchPhotoBuffer(fresh[Math.min(index, fresh.length - 1)], maxWidth));
		}

		// Cache for 24 hours (under the requested ref, so repeat requests for a
		// stale ref are served from cache without re-resolving)
		await redis.setex(cacheKey, 86400, data);

		res.set("Content-Type", contentType);
		res.set("Cache-Control", "public, max-age=86400");
		return res.send(data);
	} catch (err) {
		const e: any = err;
		console.error(
			"Photo proxy error:",
			e?.response?.status ?? "no-status",
			e?.response?.data
				? Buffer.from(e.response.data).toString().slice(0, 300)
				: e?.message,
		);
		return res.status(502).json({ message: "Could not fetch photo" });
	}
});
