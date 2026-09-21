import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { authenticate, optionalAuth, AuthenticatedRequest } from '../middleware/authenticate';
import { resolveOrCreatePlace, DailyPlaceLimitError } from '../services/memberPlaces';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export const communityRouter = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const UUID_RE = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

// Who may see a post: everyone if it is public, its author always, any signed-in
// member if it is members-only, and accepted connections if it is connections-only.
// `viewer` is a SQL expression for the viewer's user id (NULL when signed out).
const visibleToViewer = (post: string, viewer: string) => `(
  ${post}.visibility = 'public'
  OR ${post}.author_id = ${viewer}
  OR (${post}.visibility = 'members' AND ${viewer} IS NOT NULL)
  OR (${post}.visibility = 'connections' AND EXISTS (
    SELECT 1 FROM member_connections mc
    WHERE mc.status = 'accepted'
      AND ((mc.requester_id = ${post}.author_id AND mc.recipient_id = ${viewer})
        OR (mc.recipient_id = ${post}.author_id AND mc.requester_id = ${viewer}))
  ))
)`;

// Only files that came out of POST /community/upload may be attached to a post.
const UPLOAD_URL_RE = /^\/uploads\/[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|png|webp|heic)$/;

// Does the file's own first bytes match the type the client claims?
function looksLikeImage(buf: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/jpeg': return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/png': return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp': return buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'image/heic': return buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp';
    default: return false;
  }
}

// ─── SCHEMAS ─────────────────────────────────────────────────────────────────

const createPostSchema = z.object({
  body: z.string().min(1).max(2000).optional(),
  region: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  placeId: z.string().uuid().optional(),
  // Tag a place the catalog doesn't have yet -- resolved (matched to an
  // existing place) or created (source='member') in memberPlaces.ts before
  // the post itself is inserted. Mutually meaningful with placeId, but not
  // enforced as exclusive here -- if both are somehow sent, placeId wins
  // (see the handler below), same "explicit reference beats a derived one"
  // rule as everywhere else this pattern shows up.
  newPlace: z.object({
    name: z.string().min(1).max(200),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    category: z.enum(['food', 'accommodation', 'activity', 'transport']),
  }).optional(),
  operatorId: z.string().uuid().optional(),
  visibility: z.enum(['public', 'connections', 'private']).default('public'),
  mediaUrls: z.array(z.string().regex(UPLOAD_URL_RE, 'Photos must be uploaded through Drift first')).max(5).optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(1000),
});

// ─── FEED ─────────────────────────────────────────────────────────────────────

// GET /api/v1/community/feed
// Main feed — posts from followed members + same region
communityRouter.get('/feed', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', region } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    const result = await pool.query(
      `SELECT
         cp.id,
         cp.body,
         cp.region,
         cp.lat,
         cp.lng,
         cp.reaction_count,
         cp.comment_count,
         cp.save_count,
         cp.created_at,
         cp.author_type,
         -- Author info
         u.id AS author_id,
         t.display_name,
         t.avatar_url,
         t.nationality,
         -- Place info
         pc.name AS place_name,
         pc.category AS place_category,
         -- Media
         COALESCE(
           json_agg(pm.url ORDER BY pm.sort_order) FILTER (WHERE pm.id IS NOT NULL),
           '[]'
         ) AS media,
         -- Viewer's reaction
         pr.reaction AS my_reaction,
         -- Viewer's save
         CASE WHEN ms.id IS NOT NULL THEN true ELSE false END AS is_saved
       FROM community_posts cp
       JOIN users u ON u.id = cp.author_id
       LEFT JOIN travelers t ON t.user_id = cp.author_id
       LEFT JOIN places_cache pc ON pc.id = cp.place_id
       LEFT JOIN post_media pm ON pm.post_id = cp.id
       LEFT JOIN post_reactions pr ON pr.post_id = cp.id AND pr.user_id = $1
       LEFT JOIN member_saves ms ON ms.user_id = $1 AND ms.entity_type = 'post' AND ms.entity_id = cp.id
       WHERE cp.is_deleted = FALSE
         AND cp.visibility = 'public'
         AND (
           cp.author_id IN (
             SELECT CASE WHEN requester_id = $1 THEN recipient_id ELSE requester_id END
             FROM member_connections
             WHERE (requester_id = $1 OR recipient_id = $1) AND status = 'accepted'
           )
           OR cp.author_id = $1
           ${region ? 'OR cp.region ILIKE $4' : ''}
         )
       GROUP BY cp.id, u.id, t.display_name, t.avatar_url, t.nationality,
                pc.name, pc.category, pr.reaction, ms.id
       ORDER BY cp.created_at DESC
       LIMIT $2 OFFSET $3`,
      region
        ? [req.user!.id, parseInt(limit as string), offset, `%${region}%`]
        : [req.user!.id, parseInt(limit as string), offset]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/community/discover
// Discover tab — top posts by engagement, no follow requirement
communityRouter.get('/discover', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', region } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const userId = req.user?.id ?? null;

    const result = await pool.query(
      `SELECT
         cp.id,
         cp.body,
         cp.region,
         cp.lat,
         cp.lng,
         cp.reaction_count,
         cp.comment_count,
         cp.save_count,
         cp.created_at,
         cp.author_type,
         u.id AS author_id,
         t.display_name,
         t.avatar_url,
         t.nationality,
         pc.name AS place_name,
         pc.category AS place_category,
         COALESCE(
           json_agg(pm.url ORDER BY pm.sort_order) FILTER (WHERE pm.id IS NOT NULL),
           '[]'
         ) AS media,
         pr.reaction AS my_reaction
       FROM community_posts cp
       JOIN users u ON u.id = cp.author_id
       LEFT JOIN travelers t ON t.user_id = cp.author_id
       LEFT JOIN places_cache pc ON pc.id = cp.place_id
       LEFT JOIN post_media pm ON pm.post_id = cp.id
       LEFT JOIN post_reactions pr ON pr.post_id = cp.id AND pr.user_id = $1
       WHERE cp.is_deleted = FALSE AND cp.visibility = 'public'
         ${region ? 'AND cp.region ILIKE $4' : ''}
       GROUP BY cp.id, u.id, t.display_name, t.avatar_url, t.nationality,
                pc.name, pc.category, pr.reaction
       ORDER BY (cp.reaction_count * 2 + cp.comment_count + cp.save_count) DESC,
                cp.created_at DESC
       LIMIT $2 OFFSET $3`,
      region
        ? [userId, parseInt(limit as string), offset, `%${region}%`]
        : [userId, parseInt(limit as string), offset]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── POSTS ────────────────────────────────────────────────────────────────────

// POST /api/v1/community/posts
communityRouter.post('/posts', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createPostSchema.parse(req.body);

    if (!body.body && (!body.mediaUrls || body.mediaUrls.length === 0)) {
      return res.status(400).json({ message: 'Post must have text or media' });
    }

    // Determine author type
    const operatorCheck = await pool.query(
      `SELECT id FROM operators WHERE user_id = $1`,
      [req.user!.id]
    );
    const authorType = operatorCheck.rows.length > 0 ? 'operator' : 'member';

    // Resolve a tagged-but-not-yet-cataloged place before the post itself is
    // inserted -- either matches an existing places_cache row (the
    // corroboration path) or creates a new source='member' one.
    let resolvedPlaceId = body.placeId ?? null;
    if (!resolvedPlaceId && body.newPlace) {
      if (!body.region) {
        return res.status(400).json({ message: 'Pick a region before adding a new place -- it needs somewhere to be found later.' });
      }
      try {
        resolvedPlaceId = await resolveOrCreatePlace({
          name: body.newPlace.name,
          lat: body.newPlace.lat,
          lng: body.newPlace.lng,
          region: body.region || '',
          category: body.newPlace.category,
          submittedBy: req.user!.id,
        });
      } catch (err) {
        if (err instanceof DailyPlaceLimitError) {
          return res.status(429).json({ message: err.message });
        }
        throw err;
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const post = await client.query(
        `INSERT INTO community_posts
           (author_id, author_type, body, region, lat, lng, place_id, operator_id, visibility)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, created_at`,
        [req.user!.id, authorType, body.body ?? '', body.region ?? null,
         body.lat ?? null, body.lng ?? null, resolvedPlaceId,
         body.operatorId ?? null, body.visibility]
      );

      const postId = post.rows[0].id;

      // Insert media URLs
      if (body.mediaUrls && body.mediaUrls.length > 0) {
        for (let i = 0; i < body.mediaUrls.length; i++) {
          await client.query(
            `INSERT INTO post_media (post_id, url, sort_order) VALUES ($1, $2, $3)`,
            [postId, body.mediaUrls[i], i]
          );
        }
      }

      await client.query('COMMIT');

      return res.status(201).json({
        postId,
        createdAt: post.rows[0].created_at,
        placeId: resolvedPlaceId,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/community/posts/:id
communityRouter.get('/posts/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id ?? null;
    if (!isUuid(req.params.id)) return res.status(404).json({ message: 'Post not found' });

    const result = await pool.query(
      `SELECT
         cp.*,
         u.id AS author_user_id,
         t.display_name,
         t.avatar_url,
         t.nationality,
         pc.name AS place_name,
         pc.address AS place_address,
         pc.category AS place_category,
         COALESCE(
           json_agg(pm.url ORDER BY pm.sort_order) FILTER (WHERE pm.id IS NOT NULL),
           '[]'
         ) AS media,
         pr.reaction AS my_reaction
       FROM community_posts cp
       JOIN users u ON u.id = cp.author_id
       LEFT JOIN travelers t ON t.user_id = cp.author_id
       LEFT JOIN places_cache pc ON pc.id = cp.place_id
       LEFT JOIN post_media pm ON pm.post_id = cp.id
       LEFT JOIN post_reactions pr ON pr.post_id = cp.id AND pr.user_id = $2
       WHERE cp.id = $1 AND cp.is_deleted = FALSE
         AND ${visibleToViewer('cp', '$2::uuid')}
       GROUP BY cp.id, u.id, t.display_name, t.avatar_url, t.nationality,
                pc.name, pc.address, pc.category, pr.reaction`,
      [req.params.id, userId]
    );

    if (!result.rows.length) return res.status(404).json({ message: 'Post not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/v1/community/posts/:id
communityRouter.delete('/posts/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ message: 'Post not found' });
    const result = await pool.query(
      `UPDATE community_posts SET is_deleted = TRUE
       WHERE id = $1 AND author_id = $2
       RETURNING id`,
      [req.params.id, req.user!.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Post not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── REACTIONS ────────────────────────────────────────────────────────────────

// POST /api/v1/community/posts/:id/react
communityRouter.post('/posts/:id/react', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const reaction = req.body?.reaction ?? 'like';
    const valid = ['like', 'fire', 'heart', 'wave'];
    if (!valid.includes(reaction)) return res.status(400).json({ message: 'Invalid reaction' });

    if (!isUuid(req.params.id)) return res.status(404).json({ message: 'Post not found' });
    const visible = await pool.query(
      `SELECT 1 FROM community_posts cp WHERE cp.id = $1 AND cp.is_deleted = FALSE AND ${visibleToViewer('cp', '$2::uuid')}`,
      [req.params.id, req.user!.id]
    );
    if (!visible.rows.length) return res.status(404).json({ message: 'Post not found' });

    // A member has one reaction per post (unique on post + user).
    // Same reaction again removes it; a different one replaces it.
    const existing = await pool.query(
      `SELECT reaction FROM post_reactions WHERE post_id = $1 AND user_id = $2`,
      [req.params.id, req.user!.id]
    );

    if (existing.rows.length && existing.rows[0].reaction === reaction) {
      await pool.query(
        `DELETE FROM post_reactions WHERE post_id = $1 AND user_id = $2`,
        [req.params.id, req.user!.id]
      );
      return res.json({ action: 'removed', reaction });
    }

    await pool.query(
      `INSERT INTO post_reactions (post_id, user_id, reaction) VALUES ($1, $2, $3)
       ON CONFLICT (post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction`,
      [req.params.id, req.user!.id, reaction]
    );
    return res.json({ action: existing.rows.length ? 'changed' : 'added', reaction });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── COMMENTS ────────────────────────────────────────────────────────────────

// GET /api/v1/community/posts/:id/comments
communityRouter.get('/posts/:id/comments', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ message: 'Post not found' });
    const result = await pool.query(
      `SELECT
         pc.id,
         pc.body,
         pc.created_at,
         u.id AS author_id,
         t.display_name,
         t.avatar_url
       FROM post_comments pc
       JOIN community_posts cp ON cp.id = pc.post_id
       JOIN users u ON u.id = pc.user_id
       LEFT JOIN travelers t ON t.user_id = pc.user_id
       WHERE pc.post_id = $1 AND pc.is_deleted = FALSE AND pc.is_hidden = FALSE
         AND cp.is_deleted = FALSE AND ${visibleToViewer('cp', '$2::uuid')}
       ORDER BY pc.created_at ASC`,
      [req.params.id, req.user?.id ?? null]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/community/posts/:id/comments
communityRouter.post('/posts/:id/comments', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = commentSchema.parse(req.body);

    if (!isUuid(req.params.id)) return res.status(404).json({ message: 'Post not found' });
    const visible = await pool.query(
      `SELECT 1 FROM community_posts cp WHERE cp.id = $1 AND cp.is_deleted = FALSE AND ${visibleToViewer('cp', '$2::uuid')}`,
      [req.params.id, req.user!.id]
    );
    if (!visible.rows.length) return res.status(404).json({ message: 'Post not found' });

    const result = await pool.query(
      `INSERT INTO post_comments (post_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [req.params.id, req.user!.id, body.body]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/v1/community/posts/:postId/comments/:commentId
communityRouter.delete('/posts/:postId/comments/:commentId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isUuid(req.params.postId) || !isUuid(req.params.commentId)) return res.status(404).json({ message: 'Comment not found' });
    const result = await pool.query(
      `UPDATE post_comments SET is_deleted = TRUE
       WHERE id = $1 AND post_id = $2 AND user_id = $3 AND is_deleted = FALSE
       RETURNING id`,
      [req.params.commentId, req.params.postId, req.user!.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Comment not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── PHOTO UPLOAD ─────────────────────────────────────────────────────────────

// POST /api/v1/community/upload
// Accepts base64 encoded image, saves to disk, returns URL
communityRouter.post('/upload', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, mimeType } = req.body;
    if (!data || !mimeType) return res.status(400).json({ message: 'data and mimeType required' });

    const validTypes: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
    };

    if (!validTypes[mimeType]) return res.status(400).json({ message: 'Invalid image type' });

    if (typeof data !== 'string') return res.status(400).json({ message: 'data must be a base64 string' });

    // Decode base64
    const buffer = Buffer.from(data, 'base64');

    // Limit 10MB
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ message: 'Image too large (max 10MB)' });
    }

    // The bytes must really be the image type claimed (a text or HTML file
    // renamed to .png must not be stored and served from our own domain).
    if (!looksLikeImage(buffer, mimeType)) {
      return res.status(400).json({ message: 'That file is not a valid image' });
    }

    const filename = `${crypto.randomUUID()}.${validTypes[mimeType]}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filepath, buffer);

    const url = `/uploads/${filename}`;
    return res.status(201).json({ url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/community/posts — member's own posts
communityRouter.get('/posts', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { memberId } = req.query;
    if (memberId !== undefined && !isUuid(memberId)) return res.status(400).json({ message: 'Invalid memberId' });
    const targetId = memberId ?? req.user!.id;

    const result = await pool.query(
      `SELECT
         cp.id, cp.body, cp.region, cp.reaction_count,
         cp.comment_count, cp.created_at,
         COALESCE(
           json_agg(pm.url ORDER BY pm.sort_order) FILTER (WHERE pm.id IS NOT NULL),
           '[]'
         ) AS media
       FROM community_posts cp
       LEFT JOIN post_media pm ON pm.post_id = cp.id
       WHERE cp.author_id = $1 AND cp.is_deleted = FALSE
         AND (cp.visibility = 'public' OR cp.author_id = $2)
       GROUP BY cp.id
       ORDER BY cp.created_at DESC
       LIMIT 50`,
      [targetId, req.user!.id]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
