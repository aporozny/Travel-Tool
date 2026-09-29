import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';
import { listModerationQueue, decideModeration, queueQuerySchema, decideBodySchema, ModerationAdminError } from '../services/moderationAdmin';

// Admin-only: reviewing content the automated pipeline (services/moderation.ts) queued as
// pending/held, and the same for content three members independently reported.
export const moderationAdminRouter = Router();

function requireAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ message: 'Admin only' });
    return false;
  }
  return true;
}

// GET /api/v1/admin/moderation/queue
moderationAdminRouter.get('/moderation/queue', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const query = queueQuerySchema.parse(req.query);
    return res.json({ items: await listModerationQueue(query.status, query.limit) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message ?? 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/admin/moderation/:contentType/:contentId/decide
moderationAdminRouter.post(
  '/moderation/:contentType/:contentId/decide',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const contentType = z.enum(['post', 'comment']).parse(req.params.contentType);
      const contentId = z.string().uuid().parse(req.params.contentId);
      const body = decideBodySchema.parse(req.body);
      const result = await decideModeration(contentType, contentId, body.verdict, body.note, req.user!.id);
      return res.json(result);
    } catch (err) {
      if (err instanceof ModerationAdminError) return res.status(err.status).json({ message: err.message });
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message ?? 'Validation error', errors: err.errors });
      console.error(err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
);
