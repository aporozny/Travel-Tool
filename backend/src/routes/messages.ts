import { Router, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';

export const messagesRouter = Router();

const sendSchema = z.object({
  recipient_id: z.string().uuid(),
  body: z.string().min(1).max(2000).trim(),
});

// GET /api/v1/messages
// Get all conversations (one per connected member)
messagesRouter.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (other_user_id)
         m.id, m.body, m.created_at, m.is_read,
         m.sender_id, m.recipient_id,
         CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS other_user_id,
         COALESCE(t.display_name, t.first_name, split_part(u.email, '@', 1)) AS other_name,
         t.avatar_url AS other_avatar,
         (SELECT COUNT(*) FROM member_messages 
          WHERE recipient_id = $1 AND sender_id = other_user_id_sub AND is_read = false) AS unread_count
       FROM member_messages m
       JOIN (SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_user_id_sub
             FROM member_messages WHERE sender_id = $1 OR recipient_id = $1) sub ON true
       JOIN users u ON u.id = CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END
       JOIN travelers t ON t.user_id = u.id
       WHERE (m.sender_id = $1 OR m.recipient_id = $1)
         AND CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END = other_user_id_sub
       ORDER BY other_user_id, m.created_at DESC`,
      [req.user!.id]
    );

    // Simpler approach - get unique conversation partners
    const convResult = await pool.query(
      `WITH partners AS (
         SELECT DISTINCT
           CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS partner_id
         FROM member_messages
         WHERE sender_id = $1 OR recipient_id = $1
       ),
       last_messages AS (
         SELECT DISTINCT ON (CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END)
           id, body, created_at, is_read, sender_id, recipient_id,
           CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS partner_id
         FROM member_messages
         WHERE sender_id = $1 OR recipient_id = $1
         ORDER BY partner_id, created_at DESC
       )
       SELECT
         lm.*,
         COALESCE(t.display_name, t.first_name, split_part(u.email, '@', 1)) AS other_name,
         t.avatar_url AS other_avatar,
         (SELECT COUNT(*) FROM member_messages
          WHERE recipient_id = $1 AND sender_id = lm.partner_id AND is_read = false) AS unread_count
       FROM last_messages lm
       JOIN users u ON u.id = lm.partner_id
       JOIN travelers t ON t.user_id = u.id
       ORDER BY lm.created_at DESC`,
      [req.user!.id]
    );

    return res.json(convResult.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/messages/:userId
// Get message thread with a specific user
messagesRouter.get('/:userId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;

    // Verify they are connected
    const connResult = await pool.query(
      `SELECT id FROM member_connections
       WHERE ((requester_id = $1 AND recipient_id = $2)
          OR (requester_id = $2 AND recipient_id = $1))
         AND status = 'accepted'`,
      [req.user!.id, userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(403).json({ message: 'You must be connected to message this member' });
    }

    // Mark messages as read
    await pool.query(
      `UPDATE member_messages SET is_read = true
       WHERE recipient_id = $1 AND sender_id = $2 AND is_read = false`,
      [req.user!.id, userId]
    );

    // Get messages
    const result = await pool.query(
      `SELECT
         m.id, m.body, m.created_at, m.is_read,
         m.sender_id,
         COALESCE(t.display_name, t.first_name, split_part(u.email, '@', 1)) AS sender_name,
         t.avatar_url AS sender_avatar
       FROM member_messages m
       JOIN users u ON u.id = m.sender_id
       JOIN travelers t ON t.user_id = u.id
       WHERE (m.sender_id = $1 AND m.recipient_id = $2)
          OR (m.sender_id = $2 AND m.recipient_id = $1)
       ORDER BY m.created_at ASC
       LIMIT 100`,
      [req.user!.id, userId]
    );

    // Get other user info
    const userResult = await pool.query(
      `SELECT COALESCE(t.display_name, t.first_name, split_part(u.email, '@', 1)) AS name,
              t.avatar_url
       FROM users u JOIN travelers t ON t.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    return res.json({
      messages: result.rows,
      other_user: userResult.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/messages
// Send a message
messagesRouter.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = sendSchema.parse(req.body);

    if (body.recipient_id === req.user!.id) {
      return res.status(400).json({ message: 'Cannot message yourself' });
    }

    // Verify connected
    const connResult = await pool.query(
      `SELECT id FROM member_connections
       WHERE ((requester_id = $1 AND recipient_id = $2)
          OR (requester_id = $2 AND recipient_id = $1))
         AND status = 'accepted'`,
      [req.user!.id, body.recipient_id]
    );

    if (connResult.rows.length === 0) {
      return res.status(403).json({ message: 'You must be connected to send messages' });
    }

    const blockResult = await pool.query(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)`,
      [req.user!.id, body.recipient_id]
    );

    if (blockResult.rows.length > 0) {
      return res.status(403).json({ message: 'You cannot message this member' });
    }

    // connection_id is NOT NULL on member_messages -- connResult above
    // already looked this row up to verify the connection exists; this was
    // previously discarded and never passed to the INSERT, which made
    // every message send 500 (found live while verifying the block
    // feature below, not related to blocking itself).
    const result = await pool.query(
      `INSERT INTO member_messages (id, connection_id, sender_id, recipient_id, body)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       RETURNING id, body, created_at, is_read, sender_id`,
      [connResult.rows[0].id, req.user!.id, body.recipient_id, body.body]
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

// GET /api/v1/messages/unread/count
// Unread message count for badge
messagesRouter.get('/unread/count', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS count FROM member_messages
       WHERE recipient_id = $1 AND is_read = false`,
      [req.user!.id]
    );
    return res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
