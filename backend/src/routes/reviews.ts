import { Router, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';

export const reviewsRouter = Router();

const createReviewSchema = z.object({
  booking_id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().min(1).max(255).optional(),
  body: z.string().min(10).max(3000).optional(),
});

// POST /api/v1/reviews
// Traveler submits a review for a completed booking
reviewsRouter.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'traveler') {
      return res.status(403).json({ message: 'Only travelers can submit reviews' });
    }

    const body = createReviewSchema.parse(req.body);

    // Verify booking exists, is completed, and belongs to this traveler
    const bookingResult = await pool.query(
      `SELECT b.id, b.operator_id, b.status
       FROM bookings b
       JOIN travelers t ON t.id = b.traveler_id
       WHERE b.id = $1 AND t.user_id = $2`,
      [body.booking_id, req.user!.id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    if (booking.status !== 'completed') {
      return res.status(400).json({ message: 'Can only review completed bookings' });
    }

    // Check no review already exists for this booking
    const existing = await pool.query(
      'SELECT id FROM reviews WHERE booking_id = $1',
      [body.booking_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Review already submitted for this booking' });
    }

    // Get traveler id
    const travelerResult = await pool.query(
      'SELECT id FROM travelers WHERE user_id = $1',
      [req.user!.id]
    );

    const result = await pool.query(
      `INSERT INTO reviews
         (id, booking_id, traveler_id, operator_id, rating, title, body, is_published)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true)
       RETURNING id, rating, title, body, is_published, created_at`,
      [
        body.booking_id,
        travelerResult.rows[0].id,
        booking.operator_id,
        body.rating,
        body.title ?? null,
        body.body ?? null,
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

// GET /api/v1/reviews/operator/:operatorId
// Public - get all published reviews for an operator
reviewsRouter.get('/operator/:operatorId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit = '20', offset = '0' } = req.query;

    const result = await pool.query(
      `SELECT r.id, r.rating, r.title, r.body, r.created_at,
              t.first_name, t.last_name,
              COALESCE(t.first_name, 'Anonymous') AS reviewer_name
       FROM reviews r
       JOIN travelers t ON t.id = r.traveler_id
       WHERE r.operator_id = $1 AND r.is_published = true
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.operatorId, Math.min(parseInt(limit as string), 100), parseInt(offset as string)]
    );

    // Get summary stats
    const statsResult = await pool.query(
      `SELECT
         COUNT(*) AS total,
         ROUND(AVG(rating), 1) AS avg_rating,
         COUNT(*) FILTER (WHERE rating = 5) AS five_star,
         COUNT(*) FILTER (WHERE rating = 4) AS four_star,
         COUNT(*) FILTER (WHERE rating = 3) AS three_star,
         COUNT(*) FILTER (WHERE rating = 2) AS two_star,
         COUNT(*) FILTER (WHERE rating = 1) AS one_star
       FROM reviews
       WHERE operator_id = $1 AND is_published = true`,
      [req.params.operatorId]
    );

    return res.json({
      stats: statsResult.rows[0],
      reviews: result.rows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/reviews/me
// Traveler views their own submitted reviews
reviewsRouter.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.rating, r.title, r.body, r.is_published, r.created_at,
              o.business_name, o.category, o.region
       FROM reviews r
       JOIN travelers t ON t.id = r.traveler_id
       JOIN operators o ON o.id = r.operator_id
       WHERE t.user_id = $1
       ORDER BY r.created_at DESC`,
      [req.user!.id]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
