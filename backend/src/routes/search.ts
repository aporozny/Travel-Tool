import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { search, getPlaceById, enrichPlace } from '../services/searchCache';
import { pool } from '../utils/db';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';

export const searchRouter = Router();

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  region: z.string().default('Bali'),
  category: z.enum(['food', 'accommodation', 'activity', 'transport']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// GET /api/v1/search?q=diving&region=nusa-penida&category=activity
searchRouter.get('/', async (req: Request, res: Response) => {
  try {
    const params = searchSchema.parse(req.query);

    const { results, source, total } = await search(
      params.q,
      params.region,
      params.category,
      params.limit
    );

    return res.json({
      query: params.q,
      region: params.region,
      category: params.category || null,
      source,
      total,
      results,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    console.error(err);
    return res.status(500).json({ message: 'Search failed' });
  }
});

// GET /api/v1/search/places/:id - get single place with full details
searchRouter.get('/places/:id', async (req: Request, res: Response) => {
  try {
    const place = await getPlaceById(req.params.id);
    if (!place) return res.status(404).json({ message: 'Place not found' });

    // Enrich in background if phone/website missing
    if (!place.phone || !place.website) {
      enrichPlace(place.id, place.external_id).catch(() => {});
    }

    return res.json(place);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/search/places/:id/claim - operator claims a listing
searchRouter.post('/places/:id/claim', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'operator') {
      return res.status(403).json({ message: 'Only operators can claim listings' });
    }

    const { evidence } = req.body;

    // Get the place
    const place = await getPlaceById(req.params.id);
    if (!place) return res.status(404).json({ message: 'Place not found' });

    if (place.is_claimed) {
      return res.status(409).json({ message: 'This listing has already been claimed' });
    }

    // Get operator record
    const opResult = await pool.query(
      'SELECT id FROM operators WHERE user_id = $1',
      [req.user!.id]
    );
    if (opResult.rows.length === 0) {
      return res.status(404).json({ message: 'Operator profile not found. Create your operator profile first.' });
    }
    const operatorId = opResult.rows[0].id;

    // Check not already submitted a claim
    const existingClaim = await pool.query(
      'SELECT id FROM listing_claims WHERE place_cache_id = $1 AND operator_id = $2',
      [req.params.id, operatorId]
    );
    if (existingClaim.rows.length > 0) {
      return res.status(409).json({ message: 'You have already submitted a claim for this listing' });
    }

    // Create claim
    const result = await pool.query(
      `INSERT INTO listing_claims (id, place_cache_id, operator_id, evidence)
       VALUES (gen_random_uuid(), $1, $2, $3)
       RETURNING id, status, created_at`,
      [req.params.id, operatorId, evidence || null]
    );

    return res.status(201).json({
      claim_id: result.rows[0].id,
      status: result.rows[0].status,
      message: 'Claim submitted. You will be notified once reviewed.',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/search/claims - operator views their own claims
searchRouter.get('/claims', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'operator') {
      return res.status(403).json({ message: 'Operators only' });
    }

    const result = await pool.query(
      `SELECT lc.id, lc.status, lc.created_at, lc.reviewed_at,
              pc.name, pc.category, pc.address, pc.region, pc.rating
       FROM listing_claims lc
       JOIN places_cache pc ON pc.id = lc.place_cache_id
       JOIN operators o ON o.id = lc.operator_id
       WHERE o.user_id = $1
       ORDER BY lc.created_at DESC`,
      [req.user!.id]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/v1/search/claims/:id - admin approves/rejects claim
searchRouter.patch('/claims/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }

    const { status } = z.object({ status: z.enum(['approved', 'rejected']) }).parse(req.body);

    const claimResult = await pool.query(
      `UPDATE listing_claims
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3
       RETURNING id, place_cache_id, operator_id, status`,
      [status, req.user!.id, req.params.id]
    );

    if (claimResult.rows.length === 0) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    const claim = claimResult.rows[0];

    // If approved, link the operator to the listing
    if (status === 'approved') {
      await pool.query(
        `UPDATE places_cache
         SET is_claimed = true, claimed_by = $1, claimed_at = NOW(), operator_id = $2
         WHERE id = $3`,
        [req.user!.id, claim.operator_id, claim.place_cache_id]
      );
    }

    return res.json({ id: claim.id, status: claim.status });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
