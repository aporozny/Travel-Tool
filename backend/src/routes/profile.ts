import { Router, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';

export const profileRouter = Router();

const avatarSchema = z.object({
  imageData: z.string().min(1),
});

profileRouter.post('/avatar', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { imageData } = avatarSchema.parse(req.body);

    // Validate base64
    if (!imageData.match(/^data:image\/(jpeg|png|gif|webp);base64,/)) {
      return res.status(400).json({ error: 'Invalid image format. Use JPEG, PNG, GIF, or WebP' });
    }

    const result = await pool.query(
      'UPDATE travelers SET avatar_url = $1 WHERE user_id = $2 RETURNING id, avatar_url',
      [imageData, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Traveller profile not found' });
    }

    res.json({ success: true, avatar_url: result.rows[0].avatar_url });
  } catch (err: any) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

profileRouter.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await pool.query(
      'SELECT id, user_id, display_name, avatar_url, home_city, home_country FROM travelers WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});
