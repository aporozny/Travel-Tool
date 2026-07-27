import { pool } from '../utils/db';
import { Router, Response } from 'express';
import { authenticate, optionalAuth, AuthenticatedRequest } from '../middleware/authenticate';
import { getRecommendations, trackInteraction, toggleSave } from '../services/recommendations';

export const recommendationsRouter = Router();

// GET /api/v1/recommendations
// Personalized if authenticated, anonymous ranking if not
recommendationsRouter.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { category, region, limit, refresh, sub_area } = req.query;

    const results = await getRecommendations(
      req.user?.id || null,
      {
        category: category as string,
        region: region as string,
        limit: Math.min(parseInt(limit as string) || 20, 50),
        forceRefresh: refresh === 'true',
        subArea: sub_area as string,
      }
    );

    return res.json({
      results,
      total: results.length,
      personalized: !!req.user,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/recommendations/interact
// Track member interaction with an operator or place
recommendationsRouter.post('/interact', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { entity_type, entity_id, interaction_type, region, category, tags } = req.body;

    if (!entity_type || !entity_id || !interaction_type) {
      return res.status(400).json({ message: 'entity_type, entity_id and interaction_type required' });
    }

    if (!['operator', 'place'].includes(entity_type)) {
      return res.status(400).json({ message: 'entity_type must be operator or place' });
    }

    if (!['view', 'save', 'book', 'review', 'share'].includes(interaction_type)) {
      return res.status(400).json({ message: 'Invalid interaction_type' });
    }

    await trackInteraction(req.user!.id, entity_type, entity_id, interaction_type, { region, category, tags });

    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/recommendations/save
// Toggle save/unsave for an operator or place
recommendationsRouter.post('/save', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { entity_type, entity_id } = req.body;

    if (!entity_type || !entity_id) {
      return res.status(400).json({ message: 'entity_type and entity_id required' });
    }

    if (!['operator', 'place'].includes(entity_type)) {
      return res.status(400).json({ message: 'entity_type must be operator or place' });
    }

    const result = await toggleSave(req.user!.id, entity_type, entity_id);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/recommendations/saved
// Get all saved operators and places for the authenticated member
recommendationsRouter.get('/saved', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT ms.entity_type, ms.entity_id, ms.created_at,
              CASE ms.entity_type
                WHEN 'operator' THEN o.business_name
                WHEN 'place' THEN pc.name
              END AS name,
              CASE ms.entity_type
                WHEN 'operator' THEN o.category
                WHEN 'place' THEN pc.category
              END AS category,
              CASE ms.entity_type
                WHEN 'operator' THEN o.region
                WHEN 'place' THEN pc.region
              END AS region
       FROM member_saves ms
       LEFT JOIN operators o ON ms.entity_type = 'operator' AND o.id::text = ms.entity_id
       LEFT JOIN places_cache pc ON ms.entity_type = 'place' AND pc.id::text = ms.entity_id
       WHERE ms.user_id = $1
       ORDER BY ms.created_at DESC`,
      [req.user!.id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
