import { pool } from "../utils/db";
import { normalizeName, metersApart } from "./dedup";

// Same threshold dedup.ts uses for cross-source venue matching -- "same
// venue" should mean the same thing everywhere in this codebase, not a
// second, slightly-different heuristic invented here.
const MATCH_PROXIMITY_METERS = 150;

export interface OperatorContact {
	name: string;
	phone: string | null;
	website: string | null;
}

export interface OperatorMatchResult {
	status: "operator_match" | "no_match" | "ambiguous";
	operatorId: string | null;
	operatorContact: OperatorContact | null;
}

// Whether a bookable offer (Viator, or a future provider) corresponds to
// an already-claimed operator. This is the one function every routing
// decision in the booking flow depends on -- a false "operator_match"
// wrongly hides a real bookable offer from a user; a false "no_match"
// wrongly lets Drift earn a commission on a claimed operator's own
// business, breaking the "zero commission, ever" promise the whole
// feature exists to protect. Ambiguity must fail toward no_match/
// ambiguous, never toward a confident operator_match it can't back up.
export async function matchOfferToOperator(
	offerName: string,
	offerLat: number | null,
	offerLng: number | null,
	placeId: string | null,
): Promise<OperatorMatchResult> {
	// Fast path: the offer already resolved to an existing places_cache row
	// (via the same dedup matching the live-fetch pipeline already does),
	// and that row is already claimed. This is the highest-confidence
	// signal available -- a human already went through the claim process
	// for this exact places_cache identity.
	if (placeId) {
		const { rows } = await pool.query(
			`SELECT o.id, o.business_name, o.phone, o.website
			 FROM places_cache pc
			 JOIN operators o ON o.id = pc.operator_id
			 WHERE pc.id = $1 AND pc.operator_id IS NOT NULL`,
			[placeId],
		);
		if (rows.length === 1) {
			const op = rows[0];
			return {
				status: "operator_match",
				operatorId: op.id,
				operatorContact: { name: op.business_name, phone: op.phone, website: op.website },
			};
		}
	}

	// Fallback: direct name+proximity match against operators who
	// registered without (or before) a linked places_cache row. No
	// coordinates means no safe geo-match -- a name alone is too weak a
	// signal for a routing decision with a "never earn commission" stake
	// (two unrelated businesses can easily share a generic name like
	// "Sunset Tours"). Fail toward no_match, not operator_match.
	if (offerLat == null || offerLng == null) {
		return { status: "no_match", operatorId: null, operatorContact: null };
	}

	const { rows } = await pool.query(
		`SELECT id, business_name, phone, website,
		        ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
		 FROM operators
		 WHERE location IS NOT NULL
		   AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
		[offerLng, offerLat, MATCH_PROXIMITY_METERS],
	);

	const normalized = normalizeName(offerName);
	const candidates = rows.filter((r: any) => normalizeName(r.business_name) === normalized);

	if (candidates.length === 0) {
		// Nothing with a matching name nearby. If OTHER operators exist
		// nearby under a different name, that's a genuine ambiguous
		// signal (could be the same business under a different listed
		// name) worth a human review queue rather than a silent no_match.
		return {
			status: rows.length > 0 ? "ambiguous" : "no_match",
			operatorId: null,
			operatorContact: null,
		};
	}

	if (candidates.length > 1) {
		// Multiple same-named operators within range -- can't pick one
		// confidently.
		return { status: "ambiguous", operatorId: null, operatorContact: null };
	}

	const op = candidates[0];
	return {
		status: "operator_match",
		operatorId: op.id,
		operatorContact: { name: op.business_name, phone: op.phone, website: op.website },
	};
}

export interface BookingOfferView {
	id: string;
	name: string;
	category: string;
	priceAmount: number | null;
	priceCurrency: string | null;
	// Exactly one of these two is populated, never both -- see the CTA
	// rendering rule this enforces: an operator match means checkoutUrl
	// is always null, no exceptions, no "relabeled" version of the
	// aggregator checkout attached to the operator's identity.
	checkoutUrl: string | null;
	operatorContact: OperatorContact | null;
}

// Read-facing view of a bookable_offers row -- the single place that
// enforces "an operator_match row is never surfaced as a bookable CTA
// through Drift's aggregator relationship." Every caller (the offers
// route, any future one) must go through this, not read bookable_offers
// directly, so the constraint can't be silently bypassed by a new
// call site forgetting to check match_status.
export function toOfferView(row: any): BookingOfferView {
	const isOperatorMatch = row.match_status === "operator_match";
	return {
		id: row.id,
		name: row.name,
		category: row.category,
		priceAmount: row.price_amount != null ? parseFloat(row.price_amount) : null,
		priceCurrency: row.price_currency,
		checkoutUrl: isOperatorMatch ? null : row.checkout_url,
		operatorContact:
			isOperatorMatch && row.matched_operator_id
				? { name: row.operator_name, phone: row.operator_phone, website: row.operator_website }
				: null,
	};
}

// Viator products already land in places_cache (source='viator') via the
// existing live-fetch pipeline, with the affiliate checkout link in
// `website` and price/currency in raw_data. This turns one such row into
// a bookable_offers row, running the operator-match check exactly once
// per sync rather than on every read. Lazy/on-demand, same "cache with a
// TTL, refresh when stale" shape as the rest of this codebase (geocoding,
// search coverage) -- no new cron job needed for v1.
export async function syncOfferFromPlace(placeId: string): Promise<void> {
	const { rows } = await pool.query(
		`SELECT id, external_id, name, category, region, country, latitude, longitude, website, raw_data
		 FROM places_cache
		 WHERE id = $1 AND source = 'viator'`,
		[placeId],
	);
	const place = rows[0];
	if (!place || !place.website) return;

	const existing = await pool.query(
		`SELECT id FROM bookable_offers WHERE provider = 'viator' AND provider_product_id = $1`,
		[place.external_id],
	);
	if (existing.rows.length > 0) {
		// Already synced and not yet expired (caller only invokes this for
		// stale/missing offers -- see getOffersForPlace).
		await pool.query(`UPDATE bookable_offers SET fetched_at = NOW(), expires_at = NOW() + INTERVAL '1 hour' WHERE id = $1`, [
			existing.rows[0].id,
		]);
		return;
	}

	const match = await matchOfferToOperator(
		place.name,
		place.latitude != null ? parseFloat(place.latitude) : null,
		place.longitude != null ? parseFloat(place.longitude) : null,
		place.id,
	);

	await pool.query(
		`INSERT INTO bookable_offers
		   (provider, provider_product_id, place_id, name, region, country, category,
		    price_amount, price_currency, checkout_url, match_status, matched_operator_id, raw_data)
		 VALUES ('viator', $1, $2, $3, $4, $5, 'activity', $6, $7, $8, $9, $10, $11)
		 ON CONFLICT (provider, provider_product_id) DO UPDATE SET
		   fetched_at = NOW(), expires_at = NOW() + INTERVAL '1 hour'`,
		[
			place.external_id,
			place.id,
			place.name,
			place.region,
			place.country,
			place.raw_data?.fromPrice ?? null,
			place.raw_data?.currency ?? null,
			place.website,
			match.status,
			match.operatorId,
			place.raw_data,
		],
	);
}

export async function getOffersForPlace(placeId: string): Promise<BookingOfferView[]> {
	const fresh = await pool.query(
		`SELECT 1 FROM bookable_offers WHERE place_id = $1 AND expires_at > NOW() LIMIT 1`,
		[placeId],
	);
	if (fresh.rows.length === 0) {
		await syncOfferFromPlace(placeId);
	}

	const { rows } = await pool.query(
		`SELECT bo.*, o.business_name AS operator_name, o.phone AS operator_phone, o.website AS operator_website
		 FROM bookable_offers bo
		 LEFT JOIN operators o ON o.id = bo.matched_operator_id
		 WHERE bo.place_id = $1 AND bo.expires_at > NOW()
		 ORDER BY bo.fetched_at DESC`,
		[placeId],
	);
	return rows.map(toOfferView);
}
