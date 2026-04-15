import { Router, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';

export const operatorsRouter = Router();

const createOperatorSchema = z.object({
  business_name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  category: z.enum(['accommodation', 'activity', 'transport', 'food']),
  website: z.string().url().optional(),
  phone: z.string().max(20).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  address: z.string().max(500).optional(),
  region: z.string().max(100).optional(),
  country: z.string().max(50).optional(),
});

const updateOperatorSchema = createOperatorSchema.partial();

// GET /api/v1/operators
// Public - list operators with optional filters
operatorsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { region, category, tier, lat, lng, radius } = req.query;

    let query = `
      SELECT o.id, o.business_name, o.description, o.category, o.website,
             o.phone, o.address, o.region, o.country, o.tier, o.is_verified,
             ST_X(o.location::geometry) AS longitude,
             ST_Y(o.location::geometry) AS latitude,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count
      FROM operators o
      LEFT JOIN reviews r ON r.operator_id = o.id AND r.is_published = true
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramCount = 1;

    if (region) {
      query += ` AND o.region ILIKE $${paramCount}`;
      params.push(`%${region}%`);
      paramCount++;
    }

    if (category) {
      query += ` AND o.category = $${paramCount}`;
      params.push(category);
      paramCount++;
    }

    if (tier) {
      query += ` AND o.tier = $${paramCount}`;
      params.push(tier);
      paramCount++;
    }

    // Geospatial filter - within radius (km)
    if (lat && lng && radius) {
      query += ` AND ST_DWithin(
        o.location::geography,
        ST_MakePoint($${paramCount}, $${paramCount + 1})::geography,
        $${paramCount + 2}
      )`;
      params.push(parseFloat(lng as string), parseFloat(lat as string), parseFloat(radius as string) * 1000);
      paramCount += 3;
    }

    query += ` GROUP BY o.id ORDER BY o.tier DESC, avg_rating DESC LIMIT 50`;

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/operators/search-places
// Search places_cache for unclaimed listings (for operators to find their business)
operatorsRouter.get('/search-places', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { q, region } = req.query;
    if (!q || String(q).length < 2) {
      return res.status(400).json({ message: 'Search query required (min 2 chars)' });
    }

    const result = await pool.query(
      `SELECT
         pc.id,
         pc.name,
         pc.address,
         pc.category,
         pc.region,
         pc.rating,
         pc.phone,
         pc.website,
         pc.latitude,
         pc.longitude,
         pc.operator_id,
         CASE WHEN pc.operator_id IS NOT NULL THEN true ELSE false END AS is_claimed,
         CASE WHEN lc.id IS NOT NULL THEN true ELSE false END AS has_pending_claim
       FROM places_cache pc
       LEFT JOIN listing_claims lc ON lc.place_cache_id = pc.id AND lc.status = 'pending'
       WHERE pc.name ILIKE $1
       ${region ? 'AND pc.region ILIKE $2' : ''}
       ORDER BY pc.rating DESC NULLS LAST
       LIMIT 20`,
      region ? [`%${q}%`, `%${region}%`] : [`%${q}%`]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/operators/claims
// Operator submits a claim on an unclaimed listing
operatorsRouter.post('/claims', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'operator') {
      return res.status(403).json({ message: 'Only operators can submit claims' });
    }

    const body = claimSchema.parse(req.body);

    // Check place exists
    const place = await pool.query(
      `SELECT id, name, operator_id FROM places_cache WHERE id = $1`,
      [body.place_cache_id]
    );
    if (!place.rows.length) {
      return res.status(404).json({ message: 'Place not found' });
    }
    if (place.rows[0].operator_id) {
      return res.status(409).json({ message: 'This listing has already been claimed' });
    }

    // Check no pending claim from this operator
    const existing = await pool.query(
      `SELECT id FROM listing_claims
       WHERE place_cache_id = $1 AND operator_id = (
         SELECT id FROM operators WHERE user_id = $2
       ) AND status = 'pending'`,
      [body.place_cache_id, req.user!.id]
    );
    if (existing.rows.length) {
      return res.status(409).json({ message: 'You already have a pending claim for this listing' });
    }

    // Get operator id
    const operator = await pool.query(
      `SELECT id FROM operators WHERE user_id = $1`,
      [req.user!.id]
    );
    if (!operator.rows.length) {
      return res.status(404).json({ message: 'Operator profile not found' });
    }

    const result = await pool.query(
      `INSERT INTO listing_claims (place_cache_id, operator_id, status, evidence)
       VALUES ($1, $2, 'pending', $3)
       RETURNING id, status, created_at`,
      [body.place_cache_id, operator.rows[0].id, body.evidence]
    );

    return res.status(201).json({
      claimId: result.rows[0].id,
      status: 'pending',
      placeName: place.rows[0].name,
      message: 'Claim submitted. Our team will review within 48 hours.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/operators/claims
// Operator views their own claims
operatorsRouter.get('/claims', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'operator') {
      return res.status(403).json({ message: 'Operators only' });
    }

    const result = await pool.query(
      `SELECT
         lc.id,
         lc.status,
         lc.evidence,
         lc.created_at,
         lc.reviewed_at,
         pc.name AS place_name,
         pc.address,
         pc.category,
         pc.region
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

// PATCH /api/v1/operators/claims/:id — Admin approves or rejects
operatorsRouter.patch('/claims/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }

    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status must be approved or rejected' });
    }

    const claim = await pool.query(
      `SELECT lc.*, pc.name AS place_name
       FROM listing_claims lc
       JOIN places_cache pc ON pc.id = lc.place_cache_id
       WHERE lc.id = $1`,
      [req.params.id]
    );
    if (!claim.rows.length) return res.status(404).json({ message: 'Claim not found' });
    if (claim.rows[0].status !== 'pending') {
      return res.status(409).json({ message: 'Claim already reviewed' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update claim status
      await client.query(
        `UPDATE listing_claims SET status = $1, reviewed_by = $2, reviewed_at = NOW()
         WHERE id = $3`,
        [status, req.user!.id, req.params.id]
      );

      if (status === 'approved') {
        // Link the place to the operator
        await client.query(
          `UPDATE places_cache SET operator_id = $1 WHERE id = $2`,
          [claim.rows[0].operator_id, claim.rows[0].place_cache_id]
        );

        // Mark operator as verified
        await client.query(
          `UPDATE operators SET is_verified = true WHERE id = $1`,
          [claim.rows[0].operator_id]
        );

        // Initialise operator trust score
        await client.query(
          `INSERT INTO operator_trust_scores (operator_id, score_identity)
           VALUES ($1, 100)
           ON CONFLICT (operator_id) DO UPDATE SET score_identity = 100`,
          [claim.rows[0].operator_id]
        );

        // Recompute trust score
        await client.query(
          `SELECT compute_operator_trust_score($1)`,
          [claim.rows[0].operator_id]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return res.json({
      success: true,
      status,
      placeName: claim.rows[0].place_name,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/operators/claims/queue — Admin moderation queue
operatorsRouter.get('/claims/queue', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'admin') return res.status(403).json({ message: 'Admin only' });

    const result = await pool.query(
      `SELECT
         lc.id,
         lc.status,
         lc.evidence,
         lc.created_at,
         pc.name AS place_name,
         pc.address,
         pc.category,
         pc.region,
         pc.rating,
         o.business_name,
         o.phone AS operator_phone,
         u.email AS operator_email
       FROM listing_claims lc
       JOIN places_cache pc ON pc.id = lc.place_cache_id
       JOIN operators o ON o.id = lc.operator_id
       JOIN users u ON u.id = o.user_id
       WHERE lc.status = 'pending'
       ORDER BY lc.created_at ASC`
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
// GET /api/v1/operators/:id
// Public - get single operator
operatorsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.business_name, o.description, o.category, o.website,
              o.phone, o.address, o.region, o.country, o.tier, o.is_verified,
              o.created_at,
              ST_X(o.location::geometry) AS longitude,
              ST_Y(o.location::geometry) AS latitude,
              COALESCE(AVG(r.rating), 0) AS avg_rating,
              COUNT(r.id) AS review_count
       FROM operators o
       LEFT JOIN reviews r ON r.operator_id = o.id AND r.is_published = true
       WHERE o.id = $1
       GROUP BY o.id`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Operator not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/operators
// Auth required, role must be operator
operatorsRouter.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'operator') {
      return res.status(403).json({ message: 'Only operator accounts can create listings' });
    }

    const body = createOperatorSchema.parse(req.body);

    // Check operator profile doesn't already exist for this user
    const existing = await pool.query(
      'SELECT id FROM operators WHERE user_id = $1',
      [req.user!.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Operator profile already exists' });
    }

    const result = await pool.query(
      `INSERT INTO operators
         (id, user_id, business_name, description, category, website, phone, location, address, region, country)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6,
          ${body.latitude && body.longitude ? `ST_MakePoint($7, $8)` : 'NULL'},
          $${body.latitude && body.longitude ? 9 : 7},
          $${body.latitude && body.longitude ? 10 : 8},
          $${body.latitude && body.longitude ? 11 : 9})
       RETURNING id, business_name, category, region, country, tier, is_verified, created_at`,
      body.latitude && body.longitude
        ? [req.user!.id, body.business_name, body.description ?? null, body.category,
           body.website ?? null, body.phone ?? null, body.longitude, body.latitude,
           body.address ?? null, body.region ?? null, body.country ?? 'Indonesia']
        : [req.user!.id, body.business_name, body.description ?? null, body.category,
           body.website ?? null, body.phone ?? null,
           body.address ?? null, body.region ?? null, body.country ?? 'Indonesia']
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/v1/operators/:id
// Auth required, must own the operator record
const OPERATOR_UPDATABLE_FIELDS = [
  'business_name', 'description', 'category', 'website',
  'phone', 'address', 'region', 'country',
] as const;

operatorsRouter.patch('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ownership = await pool.query(
      'SELECT id FROM operators WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.id]
    );
    if (ownership.rows.length === 0) {
      return res.status(404).json({ message: 'Operator not found or not yours' });
    }

    const body = updateOperatorSchema.parse(req.body);
    const { latitude, longitude } = body;

    // Only allow explicitly whitelisted fields - never let user input become column names
    const updates: { col: string; val: any }[] = OPERATOR_UPDATABLE_FIELDS
      .filter(f => body[f] !== undefined)
      .map(f => ({ col: f, val: body[f] }));

    if (updates.length === 0 && !latitude && !longitude) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const values: any[] = updates.map(u => u.val);
    let setClause = updates.map((u, i) => `${u.col} = $${i + 1}`).join(', ');
    let paramCount = values.length + 1;

    if (latitude !== undefined && longitude !== undefined) {
      setClause += `${setClause ? ', ' : ''}location = ST_MakePoint($${paramCount}, $${paramCount + 1})`;
      values.push(longitude, latitude);
      paramCount += 2;
    }

    const result = await pool.query(
      `UPDATE operators SET ${setClause}, updated_at = NOW()
       WHERE id = $${paramCount}
       RETURNING id, business_name, category, region, country, tier, is_verified, updated_at`,
      [...values, req.params.id]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
// =============================================================================
// OPERATOR CLAIM FLOW
// Append to /home/travel-tool/backend/src/routes/operators.ts
// =============================================================================

const claimSchema = z.object({
  place_cache_id: z.string().uuid(),
  evidence: z.string().min(10).max(2000),
  contact_email: z.string().email(),
  contact_phone: z.string().max(20).optional(),
});

