import { z } from 'zod';
import { pool } from '../utils/db';

// Admin-facing side of the moderation pipeline (migration 048/049): the review queue and the
// human decide action. See services/moderation.ts for how content gets into this queue in the
// first place, and docs/pm/BLOG-MODERATION-DESIGN-AND-IMPLEMENTATION-PLAN.md for the design.

export class ModerationAdminError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const queueQuerySchema = z.object({
  status: z.enum(['pending', 'held', 'both']).default('both'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const decideBodySchema = z.object({
  verdict: z.enum(['allow', 'block']),
  note: z.string().min(1).max(1000),
});

export interface QueueItem {
  contentType: 'post' | 'comment';
  id: string;
  body: string;
  authorId: string;
  authorName: string | null;
  createdAt: string;
  moderationStatus: 'pending' | 'held' | 'blocked';
  reporterCount: number;
  latestDecision: {
    stage: string;
    verdict: string;
    categories: string[];
    quotedSpan: string | null;
    reason: string;
    reviewerQuestion: string | null;
  } | null;
}

// One item per queued post or comment, each joined to its own latest moderation_decisions row (if
// any -- a 'pending' item may have none yet, when every stage errored before ever producing a
// verdict) and its own distinct-reporter count. Posts and comments are fetched separately and
// merged in JS rather than UNIONed in SQL, since their source tables have different shapes and
// this stays far more readable than reconciling that in one query.
export async function listModerationQueue(status: 'pending' | 'held' | 'both', limit: number): Promise<QueueItem[]> {
  const statusFilter = status === 'both' ? "IN ('pending', 'held')" : `= '${status}'`;
  // status is one of a fixed zod enum, never raw user input, so string interpolation here is safe --
  // no untrusted value ever reaches this clause.
  //
  // `OR md.stage = 'appeal_requested'` (below, in both queries): an appeal never changes
  // moderation_status -- it stays 'blocked' (or 'held'), which the status filter alone would
  // otherwise exclude forever. This is the actual mechanism behind "an appeal re-enters the human
  // queue" (community.ts's handleAppeal only writes the decision row; surfacing it is this query's job).

  const posts = await pool.query(
    `SELECT cp.id, cp.body, cp.author_id, cp.created_at, cp.moderation_status,
            t.display_name,
            (SELECT count(DISTINCT reporter_id) FROM safety_reports sr WHERE sr.reported_post_id = cp.id) AS reporter_count,
            md.stage, md.verdict, md.categories, md.quoted_span, md.reason, md.reviewer_question
     FROM community_posts cp
     LEFT JOIN travelers t ON t.user_id = cp.author_id
     LEFT JOIN LATERAL (
       SELECT stage, verdict, categories, quoted_span, reason, reviewer_question
       FROM moderation_decisions WHERE post_id = cp.id ORDER BY created_at DESC LIMIT 1
     ) md ON true
     WHERE cp.is_deleted = FALSE AND (cp.moderation_status ${statusFilter} OR md.stage = 'appeal_requested')
     ORDER BY cp.created_at ASC
     LIMIT $1`,
    [limit]
  );

  const comments = await pool.query(
    `SELECT pc.id, pc.body, pc.user_id AS author_id, pc.created_at, pc.moderation_status,
            t.display_name,
            (SELECT count(DISTINCT reporter_id) FROM safety_reports sr WHERE sr.reported_comment_id = pc.id) AS reporter_count,
            md.stage, md.verdict, md.categories, md.quoted_span, md.reason, md.reviewer_question
     FROM post_comments pc
     LEFT JOIN travelers t ON t.user_id = pc.user_id
     LEFT JOIN LATERAL (
       SELECT stage, verdict, categories, quoted_span, reason, reviewer_question
       FROM moderation_decisions WHERE comment_id = pc.id ORDER BY created_at DESC LIMIT 1
     ) md ON true
     WHERE pc.is_deleted = FALSE AND (pc.moderation_status ${statusFilter} OR md.stage = 'appeal_requested')
     ORDER BY pc.created_at ASC
     LIMIT $1`,
    [limit]
  );

  const toItem = (row: any, contentType: 'post' | 'comment'): QueueItem => ({
    contentType,
    id: row.id,
    body: row.body,
    authorId: row.author_id,
    authorName: row.display_name,
    // pg parses a TIMESTAMPTZ column into a real JS Date, not a string (unlike DATE/TIMESTAMP columns
    // elsewhere in this codebase) -- normalize to ISO here so QueueItem's own createdAt: string type
    // is actually true, and so the merge-sort below can call .localeCompare() on it safely.
    createdAt: new Date(row.created_at).toISOString(),
    moderationStatus: row.moderation_status,
    reporterCount: Number(row.reporter_count),
    latestDecision: row.stage
      ? {
          stage: row.stage,
          verdict: row.verdict,
          categories: row.categories ?? [],
          quotedSpan: row.quoted_span,
          reason: row.reason,
          reviewerQuestion: row.reviewer_question,
        }
      : null,
  });

  return [...posts.rows.map((r) => toItem(r, 'post')), ...comments.rows.map((r) => toItem(r, 'comment'))]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);
}

const VERDICT_TO_STATUS: Record<'allow' | 'block', 'allowed' | 'blocked'> = { allow: 'allowed', block: 'blocked' };

export async function decideModeration(
  contentType: 'post' | 'comment',
  contentId: string,
  verdict: 'allow' | 'block',
  note: string,
  reviewerId: string
): Promise<{ status: 'allowed' | 'blocked' }> {
  const table = contentType === 'post' ? 'community_posts' : 'post_comments';
  const idColumn = contentType === 'post' ? 'post_id' : 'comment_id';
  const status = VERDICT_TO_STATUS[verdict];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(`SELECT id FROM ${table} WHERE id = $1 AND is_deleted = FALSE`, [contentId]);
    if (existing.rows.length === 0) {
      throw new ModerationAdminError(404, `${contentType === 'post' ? 'Post' : 'Comment'} not found`);
    }

    // A blocked verdict needs at least one category (moderation_decisions' own CHECK constraint) --
    // carry the prior automated categories forward if there are any, so a human decision doesn't
    // lose that context; fall back to a generic marker if this item was never automatically flagged
    // (e.g. an item held purely by member reports).
    const prior = await client.query(
      `SELECT categories FROM moderation_decisions WHERE ${idColumn} = $1 ORDER BY created_at DESC LIMIT 1`,
      [contentId]
    );
    const categories = status === 'allowed' ? [] : (prior.rows[0]?.categories?.length ? prior.rows[0].categories : ['reviewed']);

    await client.query(
      `INSERT INTO moderation_decisions (${idColumn}, stage, verdict, categories, reason, policy_version, reviewer_id)
       VALUES ($1, 'human_review', $2, $3, $4, 'v1', $5)`,
      [contentId, status, categories, note, reviewerId]
    );
    await client.query(`UPDATE ${table} SET moderation_status = $1 WHERE id = $2`, [status, contentId]);

    await client.query('COMMIT');
    return { status };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
