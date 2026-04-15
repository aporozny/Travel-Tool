-- =============================================================================
-- Migration 021: Community Feed
-- Tables: community_posts, post_media, post_reactions, post_comments
-- =============================================================================

-- Post visibility
DO $$ BEGIN
  CREATE TYPE post_visibility AS ENUM ('public', 'connections', 'private');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Post author type
DO $$ BEGIN
  CREATE TYPE post_author_type AS ENUM ('member', 'operator');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- COMMUNITY POSTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS community_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_type     post_author_type NOT NULL DEFAULT 'member',
  body            TEXT,
  region          VARCHAR(100),
  country         VARCHAR(50) DEFAULT 'Indonesia',
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  place_id        UUID REFERENCES places_cache(id),
  operator_id     UUID REFERENCES operators(id),
  visibility      post_visibility NOT NULL DEFAULT 'public',
  is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  reaction_count  INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0,
  save_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT post_has_content CHECK (body IS NOT NULL OR id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_posts_author     ON community_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_region     ON community_posts(region);
CREATE INDEX IF NOT EXISTS idx_posts_place      ON community_posts(place_id);
CREATE INDEX IF NOT EXISTS idx_posts_operator   ON community_posts(operator_id);
CREATE INDEX IF NOT EXISTS idx_posts_feed       ON community_posts(created_at DESC) WHERE is_deleted = FALSE AND visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_posts_location   ON community_posts(lat, lng) WHERE lat IS NOT NULL;

-- =============================================================================
-- POST MEDIA (photos)
-- =============================================================================

CREATE TABLE IF NOT EXISTS post_media (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  media_type  TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  width       INTEGER,
  height      INTEGER,
  size_bytes  INTEGER,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_post ON post_media(post_id);

-- =============================================================================
-- POST REACTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS post_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction    TEXT NOT NULL DEFAULT 'like' CHECK (reaction IN ('like', 'fire', 'heart', 'wave')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_reactions_post ON post_reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON post_reactions(user_id);

-- =============================================================================
-- POST COMMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS post_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_author ON post_comments(author_id);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['community_posts', 'post_comments'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s;
       CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
      t, t, t, t
    );
  END LOOP;
END $$;

-- Auto-update reaction count on posts
CREATE OR REPLACE FUNCTION update_post_reaction_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET reaction_count = reaction_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET reaction_count = GREATEST(0, reaction_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reaction_count ON post_reactions;
CREATE TRIGGER trg_reaction_count
  AFTER INSERT OR DELETE ON post_reactions
  FOR EACH ROW EXECUTE FUNCTION update_post_reaction_count();

-- Auto-update comment count on posts
CREATE OR REPLACE FUNCTION update_post_comment_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.is_deleted = TRUE AND OLD.is_deleted = FALSE) THEN
    UPDATE community_posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = COALESCE(NEW.post_id, OLD.post_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_comment_count ON post_comments;
CREATE TRIGGER trg_comment_count
  AFTER INSERT OR UPDATE OR DELETE ON post_comments
  FOR EACH ROW EXECUTE FUNCTION update_post_comment_count();

-- Create upload directory marker
SELECT 'Migration 021 complete — community feed ready' AS status;
