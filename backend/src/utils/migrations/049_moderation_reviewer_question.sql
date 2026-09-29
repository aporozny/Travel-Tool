-- Migration 049: the moderation pipeline (services/moderation.ts) computes a one-line
-- "reviewer_question" for a held/blocked verdict -- e.g. "a real local tip, or an attempt to move
-- the conversation off Drift?" -- but migration 048 never gave moderation_decisions anywhere to
-- store it, so it was computed and then silently discarded before this fix. The admin review
-- screen needs it: it's the actual prompt shown to the human deciding allow/block, distinct from
-- reason (which explains the machine's own verdict, not what a person still needs to judge).
ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS reviewer_question TEXT;
