import { Router, Request, Response } from 'express';
import { fetchPhotoBuffer } from '../services/googlePlaces';
import { redis } from '../utils/redis';

export const photosRouter = Router();

// GET /api/v1/photos?ref=<photo_reference>&w=800
// Proxies Google Place photos without exposing API key
photosRouter.get('/', async (req: Request, res: Response) => {
  const { ref, w } = req.query;

  if (!ref || typeof ref !== 'string') {
    return res.status(400).json({ message: 'Photo reference required' });
  }

  // Validate ref format - Google photo refs are alphanumeric + hyphens/underscores
  if (!/^[A-Za-z0-9_\-]+$/.test(ref)) {
    return res.status(400).json({ message: 'Invalid photo reference' });
  }

  const maxWidth = Math.min(parseInt(w as string) || 800, 1600);

  try {
    // Cache photo in Redis for 24h to avoid hammering Google
    const cacheKey = `photo:${ref}:${maxWidth}`;
    const cached = await redis.getBuffer(cacheKey);

    if (cached) {
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(cached);
    }

    const { data, contentType } = await fetchPhotoBuffer(ref, maxWidth);

    // Cache for 24 hours
    await redis.setex(cacheKey, 86400, data);

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(data);
  } catch (err) {
    console.error('Photo proxy error:', err);
    return res.status(502).json({ message: 'Could not fetch photo' });
  }
});
