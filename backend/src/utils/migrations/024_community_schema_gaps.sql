-- Migration 024: Community posts/comments/media schema gaps
--
-- backend/src/routes/community.ts references several columns that were
-- never created on the live database, causing GET /community/feed,
-- /community/discover, /community/posts/:id, and /community/posts (own
-- posts) to 500. Confirmed via direct schema inspection (\d community_posts,
-- \d post_comments, \d post_media) cross-checked against every column the
-- route code actually references.
--
-- is_deleted is added as a NEW column, separate from the existing
-- is_hidden, per explicit decision: is_deleted = the post/comment's own
-- author deleted it, is_hidden = a moderator hid it. These are different
-- concepts, not a rename of one into the other.
--
-- save_count gets both the column and a trigger, mirroring the existing
-- trg_reaction_count / update_reaction_count() pattern exactly (confirmed
-- live via pg_get_functiondef before writing this).

ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS save_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE post_media ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.update_save_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.entity_type = 'post' THEN
    UPDATE community_posts SET save_count = save_count + 1 WHERE id = NEW.entity_id;
  ELSIF TG_OP = 'DELETE' AND OLD.entity_type = 'post' THEN
    UPDATE community_posts SET save_count = GREATEST(0, save_count - 1) WHERE id = OLD.entity_id;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_save_count ON member_saves;
CREATE TRIGGER trg_save_count
  AFTER INSERT OR DELETE ON member_saves
  FOR EACH ROW EXECUTE FUNCTION update_save_count();
