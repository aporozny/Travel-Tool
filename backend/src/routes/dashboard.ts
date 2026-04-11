import { Router, Response } from 'express';
import { pool } from '../utils/db';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';

export const dashboardRouter = Router();

// All dashboard routes require operator role
dashboardRouter.use(authenticate);
dashboardRouter.use((req: AuthenticatedRequest, res: Response, next: any) => {
  if (req.user!.role !== 'operator') {
    return res.status(403).json({ message: 'Operator access required' });
  }
  next();
});

// GET /api/v1/dashboard/overview
// Key metrics for the operator
dashboardRouter.get('/overview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         o.id AS operator_id,
         o.business_name,
         o.tier,
         o.is_verified,
         o.region,
         o.category,
         COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'pending') AS pending_bookings,
         COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'confirmed') AS confirmed_bookings,
         COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'completed') AS completed_bookings,
         COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'cancelled') AS cancelled_bookings,
         COUNT(DISTINCT r.id) AS total_reviews,
         ROUND(AVG(r.rating), 1) AS avg_rating,
         COALESCE(SUM(b.total_amount) FILTER (WHERE b.status = 'completed'), 0) AS total_revenue
       FROM operators o
       LEFT JOIN bookings b ON b.operator_id = o.id
       LEFT JOIN reviews r ON r.operator_id = o.id AND r.is_published = true
       WHERE o.user_id = $1
       GROUP BY o.id`,
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Operator profile not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/dashboard/bookings
// All bookings for this operator with traveler details
dashboardRouter.get('/bookings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT
        b.id, b.status, b.start_date, b.end_date, b.guests,
        b.total_amount, b.currency, b.notes, b.created_at, b.updated_at,
        t.first_name, t.last_name,
        u.email AS traveler_email,
        t.phone AS traveler_phone,
        tp.budget_range, tp.travel_style
      FROM bookings b
      JOIN operators o ON o.id = b.operator_id
      JOIN travelers t ON t.id = b.traveler_id
      JOIN users u ON u.id = t.user_id
      LEFT JOIN traveler_preferences tp ON tp.traveler_id = t.id
      WHERE o.user_id = $1
    `;

    const params: any[] = [req.user!.id];

    if (status) {
      query += ` AND b.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY b.created_at DESC`;

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/dashboard/reviews
// All reviews with ability to see unanswered ones
dashboardRouter.get('/reviews', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         r.id, r.rating, r.title, r.body, r.created_at,
         t.first_name, t.last_name,
         b.start_date, b.end_date, b.guests
       FROM reviews r
       JOIN operators o ON o.id = r.operator_id
       JOIN travelers t ON t.id = r.traveler_id
       JOIN bookings b ON b.id = r.booking_id
       WHERE o.user_id = $1 AND r.is_published = true
       ORDER BY r.created_at DESC`,
      [req.user!.id]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/dashboard/claims
// Listing claims submitted by this operator
dashboardRouter.get('/claims', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         lc.id, lc.status, lc.evidence, lc.created_at, lc.reviewed_at,
         pc.name, pc.category, pc.address, pc.region, pc.rating, pc.review_count
       FROM listing_claims lc
       JOIN operators o ON o.id = lc.operator_id
       JOIN places_cache pc ON pc.id = lc.place_cache_id
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

// GET /api/v1/dashboard/analytics
// Booking trends over last 30 days
dashboardRouter.get('/analytics', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         DATE_TRUNC('day', b.created_at) AS date,
         COUNT(*) AS bookings,
         COUNT(*) FILTER (WHERE b.status = 'confirmed') AS confirmed,
         COUNT(*) FILTER (WHERE b.status = 'cancelled') AS cancelled,
         COALESCE(SUM(b.total_amount) FILTER (WHERE b.status IN ('confirmed','completed')), 0) AS revenue
       FROM bookings b
       JOIN operators o ON o.id = b.operator_id
       WHERE o.user_id = $1
         AND b.created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE_TRUNC('day', b.created_at)
       ORDER BY date ASC`,
      [req.user!.id]
    );

    // Rating breakdown
    const ratingsResult = await pool.query(
      `SELECT
         rating,
         COUNT(*) AS count
       FROM reviews r
       JOIN operators o ON o.id = r.operator_id
       WHERE o.user_id = $1 AND r.is_published = true
       GROUP BY rating
       ORDER BY rating DESC`,
      [req.user!.id]
    );

    return res.json({
      daily: result.rows,
      ratings: ratingsResult.rows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
