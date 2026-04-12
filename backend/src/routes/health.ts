import { Router, Request, Response } from 'express';
import { pool } from '../utils/db';

export const healthRouter = Router();

healthRouter.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'traveller-api',
    version: '0.1.0',
  });
});

// Public stats for landing page
healthRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'traveler' AND is_active = true) AS members,
        (SELECT COUNT(*) FROM operators) AS operators,
        (SELECT COUNT(*) FROM places_cache WHERE expires_at > NOW()) AS places,
        (SELECT COUNT(DISTINCT region) FROM places_cache WHERE expires_at > NOW()) AS regions
    `);
    const row = result.rows[0];
    return res.json({
      members: parseInt(row.members),
      operators: parseInt(row.operators),
      places: parseInt(row.places),
      regions: parseInt(row.regions),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
