-- Migration 041: trip reminders (step 1: email + in-app, no live flight status).
--
-- trip_segments normalises every flight leg / hotel stay a traveller has
-- booked, from either provider (tripgic_orders, flight_orders), into one
-- shape with exact UTC times. TripGic stores local times with NO timezone,
-- so dep_utc / arr_utc are computed from the airport's IANA timezone at
-- ingest, and stay NULL (and nothing is scheduled) if the airport's
-- timezone cannot be resolved -- never guessed.
--
-- scheduled_notifications is a polled table, not a Redis queue: Redis here
-- runs without persistence, times change and need updating or cancelling,
-- and volume is tiny. dedupe_key (unique) is what stops a reminder being
-- sent twice.

CREATE TABLE IF NOT EXISTS trip_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  source TEXT NOT NULL CHECK (source IN ('tripgic', 'duffel')),
  order_id TEXT NOT NULL,                 -- id of the row in tripgic_orders / flight_orders
  leg_index INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('flight', 'hotel')),
  carrier TEXT,
  flight_numbers TEXT[],
  origin_iata TEXT,
  dest_iata TEXT,
  origin_city TEXT,
  dest_city TEXT,
  dest_country TEXT,                      -- ISO-2, drives which entry requirements apply
  dep_local TEXT NOT NULL,                -- as stored: "2026-09-23T20:50:00" or a date for a stay
  arr_local TEXT,
  dep_tz TEXT,
  arr_tz TEXT,
  dep_utc TIMESTAMPTZ,                    -- NULL = timezone unresolved, nothing scheduled
  arr_utc TIMESTAMPTZ,
  place_name TEXT,                        -- hotel name
  address TEXT,
  reference TEXT,                         -- booking reference shown to the traveller
  supplier_reference TEXT,                -- airline reference (PNR) / hotel confirmation number
  order_status TEXT,                      -- held | ticketed | confirmed | cancelled | expired | failed, as of the last sync
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  is_test BOOLEAN NOT NULL DEFAULT FALSE, -- sandbox booking: labelled TEST in every message
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, order_id, leg_index)
);
CREATE INDEX IF NOT EXISTS idx_trip_segments_user ON trip_segments (user_id, dep_utc);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Kept for the next steps; nothing reads these yet.
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  offers_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_start TEXT NOT NULL DEFAULT '22:00',
  quiet_end TEXT NOT NULL DEFAULT '07:00',
  language TEXT NOT NULL DEFAULT 'en',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  segment_id UUID REFERENCES trip_segments(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                     -- confirmation | pre_7d | pre_72h | pre_24h | pre_3h | hotel_checkin
  channel TEXT NOT NULL CHECK (channel IN ('email', 'in_app')),
  send_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,        -- a stale reminder is skipped, never sent late
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed', 'cancelled')),
  dedupe_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  skip_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_due ON scheduled_notifications (status, send_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_segment ON scheduled_notifications (segment_id);

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  segment_id UUID REFERENCES trip_segments(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user ON in_app_notifications (user_id, created_at DESC);

-- Entry requirements shown in reminders. Not hard-coded in templates because
-- they change: each row carries its source and when a person last checked it.
-- A row not verified within 90 days (or never verified) is shown only as
-- "check the official requirements" with the link, never as a stated fact.
CREATE TABLE IF NOT EXISTS travel_requirements (
  rule_key TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  airport_iata TEXT,                      -- set when a rule applies to one airport only (e.g. the Bali levy)
  remind_at TEXT[] NOT NULL DEFAULT ARRAY['pre_7d'],  -- which reminders carry this rule
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_url TEXT NOT NULL,
  verified_at DATE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Only facts checked against official Indonesian government pages on
-- 2026-09-20 carry a verified_at (passport validity, e-VOA price and validity,
-- the levy amount). The arrival-card rule was not confirmed from an official
-- page, so it is shown only as "check the official site". The levy's
-- exemption rules were not checked and the text says so.
INSERT INTO travel_requirements (rule_key, country_code, airport_iata, remind_at, title, body, source_url, verified_at, sort_order) VALUES
  ('id_passport', 'ID', NULL, ARRAY['pre_7d'], 'Passport validity',
   'Indonesia''s official e-VOA guidance asks for a passport valid for at least 6 months from the date you arrive. Check your own passport''s expiry date now.',
   'https://evisa.imigrasi.go.id/front/info/evoa', '2026-09-20', 10),
  ('id_evoa', 'ID', NULL, ARRAY['pre_7d'], 'Visa on arrival (e-VOA)',
   'The official e-VOA costs IDR 500,000 and is valid for 30 days. You can apply online before you fly. Check the official site for what applies to you.',
   'https://evisa.imigrasi.go.id/front/info/evoa', '2026-09-20', 20),
  ('id_arrival_card', 'ID', NULL, ARRAY['pre_72h'], 'Arrival card',
   'Indonesia asks arriving travellers to complete an online arrival form.',
   'https://allindonesia.imigrasi.go.id', NULL, 30),
  ('id_bali_levy', 'ID', 'DPS', ARRAY['pre_7d'], 'Bali tourist levy',
   'The Bali tourist levy is IDR 150,000. Check the official site for who pays and how to pay it.',
   'https://lovebali.baliprov.go.id', '2026-09-20', 40)
ON CONFLICT (rule_key) DO NOTHING;

SELECT 'Migration 041 complete -- trip notification tables ready' AS status;
