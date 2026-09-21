-- Migration 043: three schema gaps found by the live test-plan check (21 Sep 2026).
--
-- 1. reviews.title: the reviews routes read and write it, the table never had it,
--    so GET /reviews/me and GET /reviews/operator/:id returned 500.
-- 2. community_posts.visibility: the API accepts 'private' but the database only
--    allowed public / members / connections, so a private post returned 500.
-- 3. community_posts.body: a photo-only post is allowed by the API (text OR media)
--    but the database required at least one character of text.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS title VARCHAR(255);

ALTER TABLE community_posts DROP CONSTRAINT IF EXISTS community_posts_visibility_check;
ALTER TABLE community_posts ADD CONSTRAINT community_posts_visibility_check
  CHECK (visibility IN ('public', 'members', 'connections', 'private'));

ALTER TABLE community_posts DROP CONSTRAINT IF EXISTS community_posts_body_check;
ALTER TABLE community_posts ADD CONSTRAINT community_posts_body_check
  CHECK (length(body) <= 2000);

SELECT 'Migration 043 complete -- review titles, private posts, photo-only posts' AS status;
