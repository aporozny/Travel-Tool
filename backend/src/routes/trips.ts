import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';
import { sendEmail } from '../services/notifications';

export const tripsRouter = Router();

// Owner-curated trips travelers can RSVP to -- distinct from community_posts
// (free-form traveler posts about their own trips, already built). This is
// the owner inviting travelers to join a specific trip, with a real
// capacity/RSVP model rather than just a post.

// ─── SCHEMAS ─────────────────────────────────────────────────────────────────

const createTripSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  destination: z.string().max(200).optional(),
  region: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  capacity: z.number().int().positive().optional(),
  coverImageUrl: z.string().url().optional(),
  status: z.enum(['draft', 'published']).default('published'),
});

const updateTripSchema = createTripSchema.partial().extend({
  status: z.enum(['draft', 'published', 'cancelled']).optional(),
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function requireAdmin(req: AuthenticatedRequest, res: Response): Promise<boolean> {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ message: 'Admin only' });
    return false;
  }
  return true;
}

function tripView(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    destination: row.destination,
    region: row.region,
    country: row.country,
    startDate: row.start_date,
    endDate: row.end_date,
    capacity: row.capacity,
    coverImageUrl: row.cover_image_url,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    confirmedCount: Number(row.confirmed_count ?? 0),
    waitlistedCount: Number(row.waitlisted_count ?? 0),
    spotsRemaining: row.capacity != null ? Math.max(0, row.capacity - Number(row.confirmed_count ?? 0)) : null,
    myRsvpStatus: row.my_rsvp_status ?? null,
  };
}

const TRIP_LIST_QUERY = `
  SELECT t.*,
    COUNT(*) FILTER (WHERE r.status = 'confirmed') AS confirmed_count,
    COUNT(*) FILTER (WHERE r.status = 'waitlisted') AS waitlisted_count,
    (SELECT status FROM trip_rsvps WHERE trip_id = t.id AND user_id = $1) AS my_rsvp_status
  FROM trips t
  LEFT JOIN trip_rsvps r ON r.trip_id = t.id
`;

// ─── TRIPS ───────────────────────────────────────────────────────────────────

// GET /api/v1/trips
// Published trips, newest first. Admins also see their own drafts.
tripsRouter.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const showDrafts = req.user!.role === 'admin';
    const { rows } = await pool.query(
      `${TRIP_LIST_QUERY}
       WHERE t.status = 'published' ${showDrafts ? "OR (t.status = 'draft' AND t.created_by = $1)" : ''}
       GROUP BY t.id
       ORDER BY t.start_date NULLS LAST, t.created_at DESC`,
      [req.user!.id]
    );
    return res.json({ trips: rows.map(tripView) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/trips/:id
tripsRouter.get('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { rows } = await pool.query(`${TRIP_LIST_QUERY} WHERE t.id = $2 GROUP BY t.id`, [req.user!.id, req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Trip not found' });
    const trip = rows[0];
    if (trip.status === 'draft' && trip.created_by !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(404).json({ message: 'Trip not found' });
    }
    return res.json(tripView(trip));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/trips
tripsRouter.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const body = createTripSchema.parse(req.body);

    const { rows } = await pool.query(
      `INSERT INTO trips (created_by, title, description, destination, region, country, start_date, end_date, capacity, cover_image_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, created_at`,
      [req.user!.id, body.title, body.description ?? null, body.destination ?? null, body.region ?? null,
       body.country ?? null, body.startDate ?? null, body.endDate ?? null, body.capacity ?? null,
       body.coverImageUrl ?? null, body.status]
    );
    return res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/v1/trips/:id
tripsRouter.patch('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const body = updateTripSchema.parse(req.body);

    const existing = await pool.query('SELECT created_by FROM trips WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ message: 'Trip not found' });

    const fields: Record<string, unknown> = {
      title: body.title, description: body.description, destination: body.destination,
      region: body.region, country: body.country, start_date: body.startDate, end_date: body.endDate,
      capacity: body.capacity, cover_image_url: body.coverImageUrl, status: body.status,
    };
    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const [col, val] of Object.entries(fields)) {
      if (val === undefined) continue;
      values.push(val);
      setClauses.push(`${col} = $${values.length}`);
    }
    if (setClauses.length === 0) return res.status(400).json({ message: 'No fields to update' });
    values.push(req.params.id);

    await pool.query(`UPDATE trips SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`, values);
    return res.json({ message: 'Trip updated' });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/trips/:id/rsvps
// Admin-only: who's confirmed/waitlisted, for the owner to manage the trip.
tripsRouter.get('/:id/rsvps', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.created_at, u.id AS user_id, u.email,
              t.first_name, t.last_name, t.display_name
       FROM trip_rsvps r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN travelers t ON t.user_id = u.id
       WHERE r.trip_id = $1 AND r.status != 'cancelled'
       ORDER BY r.created_at`,
      [req.params.id]
    );
    return res.json({
      rsvps: rows.map((r: any) => ({
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        userId: r.user_id,
        email: r.email,
        name: r.display_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/trips/:id/rsvp
// Confirms if there's room, otherwise waitlists -- never silently drops a
// traveler's interest just because capacity is full.
tripsRouter.post('/:id/rsvp', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tripResult = await client.query('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!tripResult.rows.length || tripResult.rows[0].status !== 'published') {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Trip not found' });
    }
    const trip = tripResult.rows[0];

    const existingRsvp = await client.query(
      `SELECT id, status FROM trip_rsvps WHERE trip_id = $1 AND user_id = $2`,
      [req.params.id, req.user!.id]
    );
    if (existingRsvp.rows.length && existingRsvp.rows[0].status !== 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Already RSVPed to this trip', status: existingRsvp.rows[0].status });
    }

    let status = 'confirmed';
    if (trip.capacity != null) {
      const countResult = await client.query(
        `SELECT COUNT(*) FROM trip_rsvps WHERE trip_id = $1 AND status = 'confirmed'`,
        [req.params.id]
      );
      if (Number(countResult.rows[0].count) >= trip.capacity) status = 'waitlisted';
    }

    if (existingRsvp.rows.length) {
      await client.query(`UPDATE trip_rsvps SET status = $1, created_at = NOW() WHERE id = $2`, [status, existingRsvp.rows[0].id]);
    } else {
      await client.query(`INSERT INTO trip_rsvps (trip_id, user_id, status) VALUES ($1, $2, $3)`, [req.params.id, req.user!.id, status]);
    }

    await client.query('COMMIT');

    const ownerResult = await pool.query('SELECT email FROM users WHERE id = $1', [trip.created_by]);
    if (ownerResult.rows.length) {
      sendEmail(
        ownerResult.rows[0].email,
        `New ${status === 'confirmed' ? 'RSVP' : 'waitlist join'} for ${trip.title}`,
        `${req.user!.email} ${status === 'confirmed' ? 'RSVPed to' : 'joined the waitlist for'} "${trip.title}".`
      ).catch((err) => console.error('trip RSVP notification failed:', err));
    }

    return res.status(201).json({ status });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/v1/trips/:id/rsvp
// Cancels the caller's own RSVP. If they held a confirmed spot, promotes
// the longest-waiting waitlisted traveler into it -- a cancellation
// should never just leave an open spot invisible to the waitlist.
tripsRouter.delete('/:id/rsvp', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, status FROM trip_rsvps WHERE trip_id = $1 AND user_id = $2 AND status != 'cancelled'`,
      [req.params.id, req.user!.id]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No active RSVP for this trip' });
    }
    const wasConfirmed = existing.rows[0].status === 'confirmed';
    await client.query(`UPDATE trip_rsvps SET status = 'cancelled' WHERE id = $1`, [existing.rows[0].id]);

    if (wasConfirmed) {
      const nextWaiting = await client.query(
        `SELECT id FROM trip_rsvps WHERE trip_id = $1 AND status = 'waitlisted' ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [req.params.id]
      );
      if (nextWaiting.rows.length) {
        await client.query(`UPDATE trip_rsvps SET status = 'confirmed' WHERE id = $1`, [nextWaiting.rows[0].id]);
      }
    }

    await client.query('COMMIT');
    return res.json({ message: 'RSVP cancelled' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});
