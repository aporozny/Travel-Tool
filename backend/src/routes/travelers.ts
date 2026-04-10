import { Router, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';

export const travelersRouter = Router();

const updateProfileSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  nationality: z.string().max(50).optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  bio: z.string().max(1000).optional(),
  avatar_url: z.string().url().optional(),
});

const preferencesSchema = z.object({
  budget_range: z.enum(['budget', 'mid', 'luxury']).optional(),
  accommodation_types: z.array(z.string()).optional(),
  activity_types: z.array(z.string()).optional(),
  travel_style: z.array(z.string()).optional(),
  dietary_requirements: z.array(z.string()).optional(),
});

// GET /api/v1/travelers/me
travelersRouter.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.first_name, t.last_name, t.phone, t.nationality,
              t.date_of_birth, t.bio, t.avatar_url, t.created_at,
              u.email, u.role
       FROM travelers t
       JOIN users u ON u.id = t.user_id
       WHERE t.user_id = $1`,
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/v1/travelers/me
travelersRouter.patch('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = updateProfileSchema.parse(req.body);

    if (Object.keys(body).length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const fields = Object.keys(body);
    const values = Object.values(body);
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

    const result = await pool.query(
      `UPDATE travelers
       SET ${setClause}, updated_at = NOW()
       WHERE user_id = $${fields.length + 1}
       RETURNING id, first_name, last_name, phone, nationality, date_of_birth, bio, avatar_url, updated_at`,
      [...values, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/travelers/me/preferences
travelersRouter.get('/me/preferences', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT tp.budget_range, tp.accommodation_types, tp.activity_types,
              tp.travel_style, tp.dietary_requirements, tp.updated_at
       FROM traveler_preferences tp
       JOIN travelers t ON t.id = tp.traveler_id
       WHERE t.user_id = $1`,
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.json({
        budget_range: null,
        accommodation_types: [],
        activity_types: [],
        travel_style: [],
        dietary_requirements: [],
      });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/v1/travelers/me/preferences
travelersRouter.put('/me/preferences', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = preferencesSchema.parse(req.body);

    // Get traveler id from user id
    const travelerResult = await pool.query(
      'SELECT id FROM travelers WHERE user_id = $1',
      [req.user!.id]
    );

    if (travelerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Traveler profile not found' });
    }

    const travelerId = travelerResult.rows[0].id;

    // Upsert preferences
    const result = await pool.query(
      `INSERT INTO traveler_preferences
         (id, traveler_id, budget_range, accommodation_types, activity_types, travel_style, dietary_requirements)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT (traveler_id) DO UPDATE SET
         budget_range = EXCLUDED.budget_range,
         accommodation_types = EXCLUDED.accommodation_types,
         activity_types = EXCLUDED.activity_types,
         travel_style = EXCLUDED.travel_style,
         dietary_requirements = EXCLUDED.dietary_requirements,
         updated_at = NOW()
       RETURNING budget_range, accommodation_types, activity_types, travel_style, dietary_requirements, updated_at`,
      [
        travelerId,
        body.budget_range ?? null,
        body.accommodation_types ?? [],
        body.activity_types ?? [],
        body.travel_style ?? [],
        body.dietary_requirements ?? [],
      ]
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
