import { Router, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { authenticate, optionalAuth, AuthenticatedRequest } from '../middleware/authenticate';

export const membersRouter = Router();

// Privacy-safe member profile query
// Only returns members who want to be in the directory
const DIRECTORY_SELECT = `
  SELECT
    t.id AS traveler_id,
    COALESCE(t.display_name, t.first_name, split_part(u.email, '@', 1)) AS display_name,
    t.home_city,
    t.home_country,
    t.avatar_url,
    mp.travel_style,
    mp.budget_range,
    mp.water_activities,
    mp.land_activities,
    mp.wellness_interests,
    mp.bucket_list_regions,
    mp.bali_areas_interest,
    mp.next_trip_timing,
    mp.travel_pace,
    mp.adrenaline_level,
    mp.social_preference,
    mp.community_participation,
    mp.travel_buddy_preferences,
    mp.sea_experience_level,
    mp.onboarding_completed,
    u.id AS user_id,
    t.created_at AS member_since
  FROM travelers t
  JOIN users u ON u.id = t.user_id
  JOIN member_preferences mp ON mp.traveler_id = t.id
  WHERE u.is_active = true
    AND t.show_in_directory = true
    AND mp.onboarding_completed = true
    AND (
      mp.community_participation && ARRAY['meet_members', 'find_travel_buddies', 'share_reports', 'ask_questions']::text[]
    )
    AND mp.content_sharing_comfort != 'private'
`;

// GET /api/v1/members
// Directory with filters - privacy-safe
membersRouter.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      region,
      activity,
      budget,
      next_trip,
      travel_style,
      limit = '20',
      offset = '0',
    } = req.query;

    let query = DIRECTORY_SELECT;
    const params: any[] = [];
    let paramCount = 1;
    const conditions: string[] = [];

    if (region) {
      conditions.push(`(mp.bucket_list_regions && ARRAY[$${paramCount}]::text[] OR mp.bali_areas_interest && ARRAY[$${paramCount}]::text[])`);
      params.push(region);
      paramCount++;
    }

    if (activity) {
      conditions.push(`(mp.water_activities && ARRAY[$${paramCount}]::text[] OR mp.land_activities && ARRAY[$${paramCount}]::text[] OR mp.wellness_interests && ARRAY[$${paramCount}]::text[])`);
      params.push(activity);
      paramCount++;
    }

    if (budget) {
      conditions.push(`mp.budget_range = $${paramCount}`);
      params.push(budget);
      paramCount++;
    }

    if (next_trip) {
      conditions.push(`mp.next_trip_timing = $${paramCount}`);
      params.push(next_trip);
      paramCount++;
    }

    if (travel_style) {
      conditions.push(`mp.travel_style && ARRAY[$${paramCount}]::text[]`);
      params.push(travel_style);
      paramCount++;
    }

    // Exclude the requesting user from their own results
    if (req.user) {
      conditions.push(`u.id != $${paramCount}`);
      params.push(req.user.id);
      paramCount++;
    }

    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }

    // Order by trip timing relevance, then join date
    query += `
      ORDER BY
        CASE mp.next_trip_timing
          WHEN 'planning_now' THEN 1
          WHEN 'already_here' THEN 1
          WHEN 'next_6_months' THEN 2
          WHEN 'within_a_year' THEN 3
          ELSE 4
        END,
        t.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    params.push(Math.min(parseInt(limit as string), 50), parseInt(offset as string));

    const result = await pool.query(query, params);

    // Get connection status for each member if authenticated
    let connectionStatuses: Record<string, string> = {};
    if (req.user && result.rows.length > 0) {
      const userIds = result.rows.map(r => r.user_id);
      const connResult = await pool.query(
        `SELECT
           CASE WHEN requester_id = $1 THEN recipient_id ELSE requester_id END AS other_user_id,
           status,
           requester_id
         FROM member_connections
         WHERE (requester_id = $1 OR recipient_id = $1)
           AND (requester_id = ANY($2) OR recipient_id = ANY($2))`,
        [req.user.id, userIds]
      );
      for (const row of connResult.rows) {
        const status = row.requester_id === req.user.id
          ? row.status
          : row.status === 'pending' ? 'pending_received' : row.status;
        connectionStatuses[row.other_user_id] = status;
      }
    }

    const members = result.rows.map(m => ({
      ...m,
      connection_status: connectionStatuses[m.user_id] || null,
    }));

    return res.json({ members, total: members.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/members/:userId
// Individual member profile - privacy safe
membersRouter.get('/my/connections', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         mc.id, mc.status, mc.message, mc.created_at,
         CASE WHEN mc.requester_id = $1 THEN mc.recipient_id ELSE mc.requester_id END AS other_user_id,
         CASE WHEN mc.requester_id = $1 THEN 'sent' ELSE 'received' END AS direction,
         COALESCE(t.display_name, t.first_name, split_part(u.email, '@', 1)) AS other_display_name,
         t.avatar_url AS other_avatar,
         mp.bucket_list_regions AS other_regions,
         mp.next_trip_timing AS other_next_trip
       FROM member_connections mc
       JOIN users u ON u.id = CASE WHEN mc.requester_id = $1 THEN mc.recipient_id ELSE mc.requester_id END
       JOIN travelers t ON t.user_id = u.id
       JOIN member_preferences mp ON mp.traveler_id = t.id
       WHERE mc.requester_id = $1 OR mc.recipient_id = $1
       ORDER BY mc.created_at DESC`,
      [req.user!.id]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

membersRouter.get('/trips', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { destination, region, looking_for } = req.query;

    let query = `
      SELECT
        mt.*,
        COALESCE(t.display_name, t.first_name, split_part(u.email, '@', 1)) AS member_name,
        t.avatar_url,
        mp.travel_style AS member_style,
        mp.budget_range,
        mp.water_activities,
        mp.adrenaline_level
      FROM member_trips mt
      JOIN users u ON u.id = mt.user_id
      JOIN travelers t ON t.user_id = u.id
      JOIN member_preferences mp ON mp.traveler_id = t.id
      WHERE mt.is_public = true
        AND u.is_active = true
        AND t.show_in_directory = true
        AND (mt.end_date IS NULL OR mt.end_date >= CURRENT_DATE)
    `;

    const params: any[] = [];
    let paramCount = 1;

    if (destination) {
      query += ` AND mt.destination ILIKE $${paramCount}`;
      params.push(`%${destination}%`);
      paramCount++;
    }

    if (region) {
      query += ` AND mt.region ILIKE $${paramCount}`;
      params.push(`%${region}%`);
      paramCount++;
    }

    if (looking_for) {
      query += ` AND mt.looking_for && ARRAY[$${paramCount}]::text[]`;
      params.push(looking_for);
      paramCount++;
    }

    if (req.user) {
      query += ` AND mt.user_id != $${paramCount}`;
      params.push(req.user.id);
      paramCount++;
    }

    query += ` ORDER BY mt.start_date ASC NULLS LAST, mt.created_at DESC LIMIT 50`;

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

membersRouter.get('/:userId', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `${DIRECTORY_SELECT} AND u.id = $1`,
      [req.params.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Member not found' });
    }

    const member = result.rows[0];

    // Connection status
    let connectionStatus = null;
    if (req.user) {
      const connResult = await pool.query(
        `SELECT status, requester_id FROM member_connections
         WHERE (requester_id = $1 AND recipient_id = $2)
            OR (requester_id = $2 AND recipient_id = $1)`,
        [req.user.id, req.params.userId]
      );
      if (connResult.rows.length > 0) {
        const conn = connResult.rows[0];
        connectionStatus = conn.requester_id === req.user.id
          ? conn.status
          : conn.status === 'pending' ? 'pending_received' : conn.status;
      }
    }

    // Get member's public trips
    const tripsResult = await pool.query(
      `SELECT id, destination, region, start_date, end_date, travel_style, looking_for, notes
       FROM member_trips
       WHERE user_id = $1 AND is_public = true
         AND (end_date IS NULL OR end_date >= CURRENT_DATE)
       ORDER BY start_date ASC NULLS LAST`,
      [req.params.userId]
    );

    return res.json({
      ...member,
      connection_status: connectionStatus,
      upcoming_trips: tripsResult.rows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/members/:userId/connect
// Send a connection request
const connectSchema = z.object({
  message: z.string().max(500).optional(),
});

membersRouter.post('/:userId/connect', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.params.userId === req.user!.id) {
      return res.status(400).json({ message: 'Cannot connect with yourself' });
    }

    const body = connectSchema.parse(req.body);

    // Check recipient exists and is in directory
    const recipientResult = await pool.query(
      `SELECT u.id FROM users u
       JOIN travelers t ON t.user_id = u.id
       JOIN member_preferences mp ON mp.traveler_id = t.id
       WHERE u.id = $1 AND u.is_active = true AND t.show_in_directory = true`,
      [req.params.userId]
    );

    if (recipientResult.rows.length === 0) {
      return res.status(404).json({ message: 'Member not found' });
    }

    // Check no existing connection
    const existing = await pool.query(
      `SELECT id, status FROM member_connections
       WHERE (requester_id = $1 AND recipient_id = $2)
          OR (requester_id = $2 AND recipient_id = $1)`,
      [req.user!.id, req.params.userId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        message: 'Connection already exists',
        status: existing.rows[0].status,
      });
    }

    const result = await pool.query(
      `INSERT INTO member_connections (id, requester_id, recipient_id, message)
       VALUES (gen_random_uuid(), $1, $2, $3)
       RETURNING id, status, created_at`,
      [req.user!.id, req.params.userId, body.message || null]
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

// PATCH /api/v1/members/connections/:connectionId
// Accept or decline a connection request
membersRouter.patch('/connections/:connectionId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = z.object({
      status: z.enum(['accepted', 'declined']),
    }).parse(req.body);

    const result = await pool.query(
      `UPDATE member_connections
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND recipient_id = $3 AND status = 'pending'
       RETURNING id, status, requester_id, recipient_id`,
      [status, req.params.connectionId, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Connection request not found' });
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

// GET /api/v1/members/me/connections
// Get my connections and pending requests

// PATCH /api/v1/members/connections/:connectionId
// Accept or decline a connection request
membersRouter.patch('/connections/:connectionId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = z.object({
      status: z.enum(['accepted', 'declined']),
    }).parse(req.body);

    const result = await pool.query(
      `UPDATE member_connections
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND recipient_id = $3 AND status = 'pending'
       RETURNING id, status, requester_id, recipient_id`,
      [status, req.params.connectionId, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Connection request not found' });
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

// GET /api/v1/members/me/connections
// Get my connections and pending requests

// POST /api/v1/members/trips
// Create a public trip plan
const tripSchema = z.object({
  destination: z.string().min(1).max(100),
  region: z.string().max(100).optional(),
  country: z.string().max(50).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  travel_style: z.array(z.string()).optional(),
  looking_for: z.array(z.string()).optional(),
  notes: z.string().max(500).optional(),
  is_public: z.boolean().default(true),
});

membersRouter.post('/trips', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = tripSchema.parse(req.body);

    const result = await pool.query(
      `INSERT INTO member_trips
         (id, user_id, destination, region, country, start_date, end_date,
          travel_style, looking_for, notes, is_public)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.user!.id, body.destination, body.region || null,
        body.country || 'Indonesia', body.start_date || null,
        body.end_date || null, body.travel_style || [],
        body.looking_for || [], body.notes || null, body.is_public,
      ]
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

// GET /api/v1/members/trips
// Browse upcoming public trips - find travel buddies
