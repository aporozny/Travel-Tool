-- Migration 048: content moderation for community posts and comments.
--
-- moderation_status is deliberately independent of is_hidden/is_deleted -- it answers "has this
-- content earned public visibility," not "did an author or mod hide it." A pipeline-blocked post
-- can have is_hidden = false (the pipeline acted, not a person); a mod can hide an allowed post for
-- an unrelated reason. The two stay orthogonal.
--
-- Column default is 'pending', not 'allowed' -- fail-closed for any future INSERT that forgets to set
-- it explicitly. That default also marks every EXISTING row pending the instant the column is added,
-- which would empty the live feed -- so the backfill UPDATE runs in the SAME transaction, before
-- anything can read the intermediate state. This repo's migrations have no other BEGIN/COMMIT and
-- have historically been applied by hand to production -- wrapping this one is the difference between
-- an atomic backfill and a production incident if the session drops mid-way.

BEGIN;

ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'pending';
UPDATE community_posts SET moderation_status = 'allowed' WHERE moderation_status = 'pending';

ALTER TABLE community_posts DROP CONSTRAINT IF EXISTS community_posts_moderation_status_check;
ALTER TABLE community_posts ADD CONSTRAINT community_posts_moderation_status_check
  CHECK (moderation_status IN ('pending', 'allowed', 'held', 'blocked'));

ALTER TABLE post_comments
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'pending';
UPDATE post_comments SET moderation_status = 'allowed' WHERE moderation_status = 'pending';

ALTER TABLE post_comments DROP CONSTRAINT IF EXISTS post_comments_moderation_status_check;
ALTER TABLE post_comments ADD CONSTRAINT post_comments_moderation_status_check
  CHECK (moderation_status IN ('pending', 'allowed', 'held', 'blocked'));

-- Admin review queue: everything not yet a final verdict, oldest first. Partial index keeps this
-- small once most content settles into 'allowed'.
CREATE INDEX IF NOT EXISTS idx_posts_moderation_queue
  ON community_posts (created_at) WHERE moderation_status IN ('pending', 'held');
CREATE INDEX IF NOT EXISTS idx_comments_moderation_queue
  ON post_comments (created_at) WHERE moderation_status IN ('pending', 'held');

-- Append-only log of every verdict a pipeline stage or a human reviewer produced. Never updated or
-- deleted -- a later stage or a human overturning an earlier verdict is a NEW row.
CREATE TABLE IF NOT EXISTS moderation_decisions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Exactly one of these two: a decision is about a post OR a comment, never both, never neither.
  post_id           UUID REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id        UUID REFERENCES post_comments(id) ON DELETE CASCADE,

  stage             TEXT NOT NULL,             -- 'rule_check' | 'openai_moderation' | 'claude_review'
                                                -- | 'member_reports' | 'human_review' | 'appeal_requested'
  verdict           TEXT NOT NULL,             -- 'allowed' | 'held' | 'blocked' -- a transient pipeline
                                                -- failure is never a verdict and never writes a row here
  categories        TEXT[] NOT NULL DEFAULT '{}',
  quoted_span       TEXT,
  reason            TEXT NOT NULL,
  policy_version    TEXT NOT NULL,

  -- Populated only when stage = 'human_review'. References users(id), NOT travelers(id) -- an admin
  -- need not have a travelers row.
  reviewer_id       UUID REFERENCES users(id),
  reviewer_response TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT moderation_decisions_exactly_one_target CHECK (
    (post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL)
  ),
  CONSTRAINT moderation_decisions_verdict_check CHECK (verdict IN ('allowed', 'held', 'blocked')),
  CONSTRAINT moderation_decisions_reviewer_fields_check CHECK (
    (stage = 'human_review' AND reviewer_id IS NOT NULL)
    OR (stage <> 'human_review' AND reviewer_id IS NULL AND reviewer_response IS NULL)
  ),
  -- cardinality(), not array_length(categories, 1): array_length() of an EMPTY (non-null) array
  -- returns NULL, not 0 -- which would make this CHECK evaluate to NULL (silently passing, the exact
  -- class of bug migration 047 hit) for a 'blocked' row with categories = '{}'. cardinality() returns
  -- 0 for an empty array, never NULL, so this stays a real true/false test in every case.
  CONSTRAINT moderation_decisions_categories_required_check CHECK (
    verdict = 'allowed' OR cardinality(categories) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_moderation_decisions_post
  ON moderation_decisions (post_id, created_at DESC) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_moderation_decisions_comment
  ON moderation_decisions (comment_id, created_at DESC) WHERE comment_id IS NOT NULL;

-- Reporting reuses safety_reports. The app layer enforces "at least one target," matching the existing
-- (unenforced-at-DB-level) looseness of reported_traveler_id/reported_operator_id/reported_place_cache_id
-- -- not tightening unrelated existing behavior as a side effect of this migration.
ALTER TABLE safety_reports
  ADD COLUMN IF NOT EXISTS reported_post_id    UUID REFERENCES community_posts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reported_comment_id UUID REFERENCES post_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sr_reported_post ON safety_reports (reported_post_id) WHERE reported_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sr_reported_comment ON safety_reports (reported_comment_id) WHERE reported_comment_id IS NOT NULL;

-- COUNT(DISTINCT reporter_id) already stops one person's repeat reports from reaching the 3-reporter
-- threshold alone, but a unique index keeps the review screen honest too.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sr_reporter_post ON safety_reports (reporter_id, reported_post_id) WHERE reported_post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sr_reporter_comment ON safety_reports (reporter_id, reported_comment_id) WHERE reported_comment_id IS NOT NULL;

COMMIT;

SELECT 'Migration 048 complete -- moderation_status, moderation_decisions, post/comment reporting ready' AS status;
