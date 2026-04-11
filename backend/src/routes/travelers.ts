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

// Whitelist of updatable preference fields and their types
const ARRAY_PREF_FIELDS = [
  'travel_style', 'languages_spoken', 'splurge_categories',
  'accommodation_types', 'accommodation_must_haves', 'accommodation_deal_breakers',
  'location_preference', 'dietary_requirements', 'cuisine_preferences',
  'food_experiences', 'water_activities', 'land_activities',
  'wellness_interests', 'cultural_interests', 'nature_interests',
  'creative_interests', 'transport_preference', 'regions_visited',
  'bucket_list_regions', 'bali_areas_interest', 'community_participation',
  'travel_buddy_preferences', 'notification_preferences',
] as const;

const SCALAR_PREF_FIELDS = [
  'trip_length_preference', 'travel_frequency', 'sea_experience_level',
  'work_situation', 'travel_pace', 'social_preference',
  'budget_range', 'accommodation_budget_aud', 'payment_preference',
  'eco_spend_willingness', 'stay_length_preference', 'food_adventurousness',
  'spice_tolerance', 'dining_style', 'coffee_preference', 'alcohol_preference',
  'meal_timing', 'nightlife_preference', 'adrenaline_level', 'animal_ethics',
  'volunteering_interest', 'sustainability_commitment', 'carbon_offset_attitude',
  'shopping_preference', 'fitness_level', 'connectivity_needs',
  'spiritual_practice', 'values_influence_travel', 'lgbtq_considerations',
  'island_hopping_appetite', 'domestic_flight_comfort', 'luggage_style',
  'next_trip_timing', 'content_sharing_comfort', 'referral_source',
] as const;

const BOOL_PREF_FIELDS = ['has_driving_licence'] as const;

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

    const PROFILE_FIELDS = ['first_name', 'last_name', 'phone', 'nationality', 'date_of_birth', 'bio', 'avatar_url'] as const;
    const fields = PROFILE_FIELDS.filter(f => body[f] !== undefined);
    const values = fields.map(f => body[f]);
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

    const result = await pool.query(
      `UPDATE travelers SET ${setClause}, updated_at = NOW()
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
      `SELECT mp.*
       FROM member_preferences mp
       JOIN travelers t ON t.id = mp.traveler_id
       WHERE t.user_id = $1`,
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.json({ onboarding_completed: false, onboarding_step: 0 });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/v1/travelers/me/preferences
// Accepts partial updates - used by onboarding flow one step at a time
travelersRouter.patch('/me/preferences', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body;

    // Get traveler id
    const travelerResult = await pool.query(
      'SELECT id FROM travelers WHERE user_id = $1',
      [req.user!.id]
    );
    if (travelerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Traveler profile not found' });
    }
    const travelerId = travelerResult.rows[0].id;

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Array fields
    for (const field of ARRAY_PREF_FIELDS) {
      if (field in body && Array.isArray(body[field])) {
        setClauses.push(`${field} = $${paramCount}`);
        values.push(body[field]);
        paramCount++;
      }
    }

    // Scalar fields
    for (const field of SCALAR_PREF_FIELDS) {
      if (field in body && body[field] !== undefined) {
        setClauses.push(`${field} = $${paramCount}`);
        values.push(body[field] || null);
        paramCount++;
      }
    }

    // Boolean fields
    for (const field of BOOL_PREF_FIELDS) {
      if (field in body && body[field] !== undefined) {
        setClauses.push(`${field} = $${paramCount}`);
        values.push(Boolean(body[field]));
        paramCount++;
      }
    }

    // Onboarding tracking
    if ('onboarding_step' in body) {
      setClauses.push(`onboarding_step = $${paramCount}`);
      values.push(parseInt(body.onboarding_step) || 0);
      paramCount++;
    }

    if ('onboarding_completed' in body && body.onboarding_completed === true) {
      setClauses.push(`onboarding_completed = true`);
      setClauses.push(`onboarding_completed_at = NOW()`);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ message: 'No valid preference fields provided' });
    }

    setClauses.push(`updated_at = NOW()`);

    const result = await pool.query(
      `INSERT INTO member_preferences (id, traveler_id, ${[...ARRAY_PREF_FIELDS, ...SCALAR_PREF_FIELDS].slice(0,1).join('')})
       VALUES (gen_random_uuid(), $${paramCount}, DEFAULT)
       ON CONFLICT (traveler_id) DO UPDATE SET ${setClauses.join(', ')}
       RETURNING *`,
      [...values, travelerId]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/travelers/me/onboarding-status
travelersRouter.get('/me/onboarding-status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT mp.onboarding_completed, mp.onboarding_step, mp.onboarding_completed_at
       FROM member_preferences mp
       JOIN travelers t ON t.id = mp.traveler_id
       WHERE t.user_id = $1`,
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.json({ onboarding_completed: false, onboarding_step: 0 });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
