-- Migration 026: Add destination to waitlist
--
-- Captures "where do you want to travel?" at request-access time, so the
-- destination is known before someone is even approved. Used to drive the
-- welcome email content and, eventually, pre-populate a trip once they
-- register.

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS destination TEXT;
