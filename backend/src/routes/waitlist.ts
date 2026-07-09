import { Router, Request, Response } from 'express';
import { pool } from '../utils/db';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';
import { z } from 'zod';
import { sendEmail } from '../services/notifications';

export const waitlistRouter = Router();
export const adminRouter = Router();

// ─── PUBLIC ROUTES ────────────────────────────────────────────────────────────

// POST /api/v1/waitlist
// Join the waitlist
const joinSchema = z.object({
  email: z.string().email(),
  name: z.string().max(100).optional(),
  destination: z.string().max(100).optional(),
  source: z.enum(['twitter', 'instagram', 'facebook', 'direct', 'referral']).optional(),
  note: z.string().max(500).optional(),
});

waitlistRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = joinSchema.parse(req.body);

    // Check if already on waitlist
    const existing = await pool.query(
      'SELECT id, status FROM waitlist WHERE email = $1',
      [body.email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      const entry = existing.rows[0];
      if (entry.status === 'joined') {
        return res.status(409).json({ message: 'You already have an account. Sign in instead.' });
      }
      return res.status(409).json({ message: 'You are already on the waitlist. We will be in touch.' });
    }

    // Check if email already has a user account
    const userExists = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [body.email.toLowerCase()]
    );

    if (userExists.rows.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists. Sign in instead.' });
    }

    await pool.query(
      `INSERT INTO waitlist (email, name, destination, source, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        body.email.toLowerCase(),
        body.name || null,
        body.destination || null,
        body.source || 'direct',
        body.note || null,
      ]
    );

    return res.status(201).json({
      message: 'You are on the list. We will be in touch when a spot opens up.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid email address.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/waitlist/check?email=...
// Check waitlist status
waitlistRouter.get('/check', async (req: Request, res: Response) => {
  const { email } = req.query;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ message: 'Email required' });
  }
  try {
    const result = await pool.query(
      'SELECT status FROM waitlist WHERE email = $1',
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.json({ status: 'not_found' });
    }
    return res.json({ status: result.rows[0].status });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/auth/invite/:token
// Validate an invite token
waitlistRouter.get('/invite/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, email, name, status, invite_expires_at
       FROM waitlist
       WHERE invite_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ valid: false, message: 'Invalid invite link.' });
    }

    const entry = result.rows[0];

    if (entry.status === 'joined') {
      return res.status(409).json({ valid: false, message: 'This invite has already been used. Sign in instead.' });
    }

    if (entry.invite_expires_at && new Date(entry.invite_expires_at) < new Date()) {
      return res.status(410).json({ valid: false, message: 'This invite has expired. Join the waitlist for a new one.' });
    }

    return res.json({
      valid: true,
      email: entry.email,
      name: entry.name,
      token,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// Simple admin auth middleware — checks for admin role on user
async function adminAuth(req: AuthenticatedRequest, res: Response, next: Function) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  const result = await pool.query(
    'SELECT role FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!result.rows.length || result.rows[0].role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

// GET /api/v1/admin/waitlist
// List all waitlist entries
adminRouter.get('/', authenticate, adminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT id, email, name, destination, source, note, status,
             invite_token, invite_expires_at, invite_used_at,
             approved_at, created_at
      FROM waitlist
    `;
    const params: any[] = [];
    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);

    const counts = await pool.query(`
      SELECT status, count(*) FROM waitlist GROUP BY status
    `);

    return res.json({
      entries: result.rows,
      counts: counts.rows.reduce((acc: any, r: any) => {
        acc[r.status] = parseInt(r.count);
        return acc;
      }, {}),
    });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/admin/waitlist/:id/approve
// Approve a waitlist entry and generate invite link
adminRouter.post('/:id/approve', authenticate, adminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  try {
    const existing = await pool.query(
      'SELECT id, email, status FROM waitlist WHERE id = $1',
      [id]
    );

    if (!existing.rows.length) {
      return res.status(404).json({ message: 'Not found' });
    }

    const entry = existing.rows[0];

    if (entry.status === 'joined') {
      return res.status(409).json({ message: 'This person already has an account.' });
    }

    // Generate a unique invite token
    const tokenResult = await pool.query('SELECT gen_random_uuid() AS token');
    const token = tokenResult.rows[0].token;
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await pool.query(
      `UPDATE waitlist
       SET status = 'invited', invite_token = $1, invite_expires_at = $2, approved_at = NOW()
       WHERE id = $3`,
      [token, expires, id]
    );

    const inviteUrl = `${process.env.APP_URL || 'https://drifttravel.app'}/invite/${token}`;

    // Send the invite email (failure must not break the approve response)
    await sendEmail(
      entry.email,
      'Your Drift invitation is ready',
      `You've been approved to join Drift.\n\nAccept your invitation and create your account:\n${inviteUrl}\n\nThis link expires in 7 days.\n\nSee you inside,\nThe Drift team`
    ).catch((e) => console.error('Invite email failed for', entry.email, e));

    return res.json({
      message: 'Approved',
      email: entry.email,
      invite_url: inviteUrl,
      expires_at: expires,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
