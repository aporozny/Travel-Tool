import { pool } from '../utils/db';

// Listing claims: an operator says "this place in the catalogue is mine", an admin
// approves or rejects. Two route files expose this (operators.ts and search.ts);
// both call the functions below so the rules cannot drift apart again.

export class ClaimError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

// ─── Trust score ─────────────────────────────────────────────────────────────

export interface TrustParts {
  identity: number;
  reviews: number;
  responsiveness: number;
  completion: number;
  safety: number;
  tenure: number;
}

// Each part is 0-100. Identity (a verified listing) counts most; a brand new
// operator with a clean safety record starts at 15 and verifying lifts them to 40.
const WEIGHTS: Record<keyof TrustParts, number> = {
  identity: 0.25, reviews: 0.2, responsiveness: 0.15, completion: 0.15, safety: 0.15, tenure: 0.1,
};

export function computeTrust(parts: TrustParts): { composite: number; tier: 'new' | 'verified' | 'trusted' | 'elite' } {
  const composite = Math.round(
    (Object.keys(WEIGHTS) as (keyof TrustParts)[]).reduce((sum, k) => sum + Math.max(0, Math.min(100, parts[k])) * WEIGHTS[k], 0)
  );
  const tier = composite >= 90 ? 'elite' : composite >= 70 ? 'trusted' : parts.identity >= 100 ? 'verified' : 'new';
  return { composite, tier };
}

// ─── Submit ──────────────────────────────────────────────────────────────────

export interface SubmitClaimInput {
  userId: string;
  placeId: string;
  evidence?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export async function submitClaim(input: SubmitClaimInput) {
  if (!isUuid(input.placeId)) throw new ClaimError(404, 'Place not found');

  const place = (await pool.query(
    'SELECT id, name, operator_id, is_claimed FROM places_cache WHERE id = $1',
    [input.placeId]
  )).rows[0];
  if (!place) throw new ClaimError(404, 'Place not found');
  if (place.operator_id || place.is_claimed) throw new ClaimError(409, 'This listing has already been claimed');

  const operator = (await pool.query('SELECT id FROM operators WHERE user_id = $1', [input.userId])).rows[0];
  if (!operator) throw new ClaimError(404, 'Operator profile not found. Create your operator profile first.');

  try {
    const result = await pool.query(
      `INSERT INTO listing_claims (place_id, user_id, operator_id, status, evidence, contact_email, contact_phone)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6)
       RETURNING id, status, created_at`,
      [input.placeId, input.userId, operator.id, input.evidence ?? null, input.contactEmail ?? null, input.contactPhone ?? null]
    );
    return { claimId: result.rows[0].id as string, status: result.rows[0].status as string, createdAt: result.rows[0].created_at, placeName: place.name as string };
  } catch (err: any) {
    // Unique index on (place, operator) while pending: a second submission, or a double click.
    if (err?.code === '23505') throw new ClaimError(409, 'You already have a pending claim for this listing');
    throw err;
  }
}

// ─── Lists ───────────────────────────────────────────────────────────────────

export async function listOwnClaims(userId: string) {
  const result = await pool.query(
    `SELECT lc.id, lc.status, lc.evidence, lc.created_at, lc.reviewed_at,
            pc.id AS place_id, pc.name AS place_name, pc.address, pc.category, pc.region, pc.rating
     FROM listing_claims lc
     JOIN places_cache pc ON pc.id = lc.place_id
     JOIN operators o ON o.id = lc.operator_id
     WHERE o.user_id = $1
     ORDER BY lc.created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function listPendingClaims() {
  const result = await pool.query(
    `SELECT lc.id, lc.status, lc.evidence, lc.contact_email, lc.contact_phone, lc.created_at,
            pc.id AS place_id, pc.name AS place_name, pc.address, pc.category, pc.region, pc.rating,
            o.business_name, o.phone AS operator_phone, u.email AS operator_email
     FROM listing_claims lc
     JOIN places_cache pc ON pc.id = lc.place_id
     JOIN operators o ON o.id = lc.operator_id
     JOIN users u ON u.id = o.user_id
     WHERE lc.status = 'pending'
     ORDER BY lc.created_at ASC`
  );
  return result.rows;
}

// ─── Review (admin) ──────────────────────────────────────────────────────────

export async function reviewClaim(claimId: string, adminUserId: string, status: 'approved' | 'rejected') {
  if (!isUuid(claimId)) throw new ClaimError(404, 'Claim not found');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the claim row so two admins cannot review it at the same moment.
    const claim = (await client.query(
      `SELECT lc.id, lc.status, lc.place_id, lc.operator_id,
              pc.name AS place_name, pc.operator_id AS place_operator_id,
              o.user_id AS operator_user_id
       FROM listing_claims lc
       JOIN places_cache pc ON pc.id = lc.place_id
       JOIN operators o ON o.id = lc.operator_id
       WHERE lc.id = $1
       FOR UPDATE OF lc`,
      [claimId]
    )).rows[0];

    if (!claim) throw new ClaimError(404, 'Claim not found');
    if (claim.status !== 'pending') throw new ClaimError(409, 'Claim already reviewed');
    if (status === 'approved' && claim.place_operator_id && claim.place_operator_id !== claim.operator_id) {
      throw new ClaimError(409, 'This listing has since been claimed by someone else');
    }

    await client.query(
      `UPDATE listing_claims SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3`,
      [status, adminUserId, claimId]
    );

    if (status === 'approved') {
      // The listing now belongs to the operator (both flags: cards read is_claimed).
      await client.query(
        `UPDATE places_cache SET operator_id = $1, is_claimed = true, claimed_by = $2, updated_at = NOW() WHERE id = $3`,
        [claim.operator_id, claim.operator_user_id, claim.place_id]
      );

      // Proving they own a listing verifies the operator.
      await client.query(`UPDATE operators SET is_verified = true, updated_at = NOW() WHERE id = $1`, [claim.operator_id]);

      // Identity score goes to 100; everything else is kept, and the composite and tier recomputed.
      const existing = (await client.query(
        `SELECT score_reviews, score_responsiveness, score_completion, score_safety_record, score_tenure
         FROM operator_trust_scores WHERE operator_id = $1 FOR UPDATE`,
        [claim.operator_id]
      )).rows[0];
      const { composite, tier } = computeTrust({
        identity: 100,
        reviews: existing?.score_reviews ?? 0,
        responsiveness: existing?.score_responsiveness ?? 0,
        completion: existing?.score_completion ?? 0,
        safety: existing?.score_safety_record ?? 100,
        tenure: existing?.score_tenure ?? 0,
      });
      await client.query(
        `INSERT INTO operator_trust_scores (operator_id, score_identity, composite_score, trust_tier)
         VALUES ($1, 100, $2, $3)
         ON CONFLICT (operator_id) DO UPDATE
           SET score_identity = 100, composite_score = EXCLUDED.composite_score, trust_tier = EXCLUDED.trust_tier,
               last_calculated_at = NOW(), updated_at = NOW()`,
        [claim.operator_id, composite, tier]
      );

      // Any other operator still waiting on this same listing has lost the claim.
      await client.query(
        `UPDATE listing_claims SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
         WHERE place_id = $2 AND status = 'pending' AND id <> $3`,
        [adminUserId, claim.place_id, claimId]
      );
    }

    await client.query('COMMIT');
    return { claimId, status, placeName: claim.place_name as string };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
