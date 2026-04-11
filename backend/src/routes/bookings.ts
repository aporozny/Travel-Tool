import { Router, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';

export const bookingsRouter = Router();

const createBookingSchema = z.object({
  operator_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  guests: z.number().int().min(1).max(50).default(1),
  total_amount: z.number().positive().optional(),
  currency: z.string().length(3).default('AUD'),
  notes: z.string().max(1000).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['confirmed', 'cancelled', 'completed']),
});

// POST /api/v1/bookings
// Traveler creates a booking request
bookingsRouter.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'traveler') {
      return res.status(403).json({ message: 'Only traveler accounts can make bookings' });
    }

    const body = createBookingSchema.parse(req.body);

    // Validate dates
    const start = new Date(body.start_date);
    const today = new Date(); today.setHours(0,0,0,0);
    if (start < today) {
      return res.status(400).json({ message: 'Start date cannot be in the past' });
    }
    if (body.end_date && new Date(body.end_date) < start) {
      return res.status(400).json({ message: 'End date must be after start date' });
    }

    // Get traveler id
    const travelerResult = await pool.query(
      'SELECT id FROM travelers WHERE user_id = $1',
      [req.user!.id]
    );
    if (travelerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Traveler profile not found' });
    }

    // Verify operator exists
    const operatorResult = await pool.query(
      'SELECT id, business_name FROM operators WHERE id = $1',
      [body.operator_id]
    );
    if (operatorResult.rows.length === 0) {
      return res.status(404).json({ message: 'Operator not found' });
    }

    const result = await pool.query(
      `INSERT INTO bookings
         (id, traveler_id, operator_id, start_date, end_date, guests, total_amount, currency, notes)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, traveler_id, operator_id, status, start_date, end_date, guests, total_amount, currency, notes, created_at`,
      [
        travelerResult.rows[0].id,
        body.operator_id,
        body.start_date,
        body.end_date ?? null,
        body.guests,
        body.total_amount ?? null,
        body.currency,
        body.notes ?? null,
      ]
    );

    return res.status(201).json({
      ...result.rows[0],
      operator_name: operatorResult.rows[0].business_name,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/bookings
// Returns bookings for the authenticated user (traveler or operator)
bookingsRouter.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let result;

    if (req.user!.role === 'traveler') {
      result = await pool.query(
        `SELECT b.id, b.status, b.start_date, b.end_date, b.guests,
                b.total_amount, b.currency, b.notes, b.created_at,
                o.id AS operator_id, o.business_name, o.category, o.region
         FROM bookings b
         JOIN travelers t ON t.id = b.traveler_id
         JOIN operators o ON o.id = b.operator_id
         WHERE t.user_id = $1
         ORDER BY b.created_at DESC`,
        [req.user!.id]
      );
    } else if (req.user!.role === 'operator') {
      result = await pool.query(
        `SELECT b.id, b.status, b.start_date, b.end_date, b.guests,
                b.total_amount, b.currency, b.notes, b.created_at,
                t.first_name, t.last_name, u.email AS traveler_email
         FROM bookings b
         JOIN operators o ON o.id = b.operator_id
         JOIN travelers t ON t.id = b.traveler_id
         JOIN users u ON u.id = t.user_id
         WHERE o.user_id = $1
         ORDER BY b.created_at DESC`,
        [req.user!.id]
      );
    } else {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/bookings/:id
bookingsRouter.get('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.status, b.start_date, b.end_date, b.guests,
              b.total_amount, b.currency, b.notes, b.created_at, b.updated_at,
              o.id AS operator_id, o.user_id AS operator_user_id, o.business_name, o.category, o.region, o.address,
              t.user_id AS traveler_user_id, t.first_name, t.last_name, u.email AS traveler_email
       FROM bookings b
       JOIN operators o ON o.id = b.operator_id
       JOIN travelers t ON t.id = b.traveler_id
       JOIN users u ON u.id = t.user_id
       WHERE b.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const booking = result.rows[0];

    // Only the traveler or the operator involved can view it - use ID not email
    const isTraveler = req.user!.role === 'traveler' && booking.traveler_user_id === req.user!.id;
    const isOperator = req.user!.role === 'operator' && booking.operator_user_id === req.user!.id;

    if (!isTraveler && !isOperator) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.json(booking);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /api/v1/bookings/:id/status
// Operator confirms/cancels, traveler can cancel
bookingsRouter.patch('/:id/status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = updateStatusSchema.parse(req.body);

    // Get the booking with ownership info
    const bookingResult = await pool.query(
      `SELECT b.id, b.status,
              t.user_id AS traveler_user_id,
              o.user_id AS operator_user_id
       FROM bookings b
       JOIN travelers t ON t.id = b.traveler_id
       JOIN operators o ON o.id = b.operator_id
       WHERE b.id = $1`,
      [req.params.id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    const userId = req.user!.id;

    // Traveler can only cancel their own bookings
    if (req.user!.role === 'traveler') {
      if (booking.traveler_user_id !== userId) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      if (status !== 'cancelled') {
        return res.status(403).json({ message: 'Travelers can only cancel bookings' });
      }
    }

    // Operator can confirm, cancel or complete their bookings
    if (req.user!.role === 'operator') {
      if (booking.operator_user_id !== userId) {
        return res.status(403).json({ message: 'Forbidden' });
      }
    }

    // Cannot change a cancelled or completed booking
    if (['cancelled', 'completed'].includes(booking.status)) {
      return res.status(400).json({ message: `Cannot update a ${booking.status} booking` });
    }

    const result = await pool.query(
      `UPDATE bookings SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, status, updated_at`,
      [status, req.params.id]
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
