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

    const location = body.latitude && body.longitude
      ? `ST_MakePoint(${body.longitude}, ${body.latitude})`
      : 'NULL';

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
operatorsRouter.patch('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Verify ownership
    const ownership = await pool.query(
      'SELECT id FROM operators WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.id]
    );

    if (ownership.rows.length === 0) {
      return res.status(404).json({ message: 'Operator not found or not yours' });
    }

    const body = updateOperatorSchema.parse(req.body);
    const { latitude, longitude, ...rest } = body; // latitude/longitude handled via ST_MakePoint below

    const fields = Object.entries(rest).filter(([, v]) => v !== undefined);

    if (fields.length === 0 && !latitude && !longitude) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    let setClause = fields.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    const values: any[] = fields.map(([, v]) => v);
    let paramCount = values.length + 1;

    if (latitude && longitude) {
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
