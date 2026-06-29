-- Migration 025: Add operator_id to community_posts
--
-- POST /api/v1/community/posts (backend/src/routes/community.ts) inserts
-- into operator_id directly, but the column never existed on the live
-- table. Confirmed via live error: "column operator_id of relation
-- community_posts does not exist" (POST /community/posts 500, June 21).
--
-- Nullable since member posts have no operator; references operators(id)
-- since an operator-authored post should be tied to a real operator row.

ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS operator_id UUID REFERENCES operators(id);
