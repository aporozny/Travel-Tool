-- Migration 003: Recommendation engine foundation

-- Add tags to operators table for preference matching
ALTER TABLE operators ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE operators ADD COLUMN IF NOT EXISTS price_level INTEGER; -- 1-4 matching Google
ALTER TABLE operators ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}'; -- photo references

-- Operator tag taxonomy - maps to member preference values
-- activity operators: scuba_diving, snorkeling, surfing, sup, sailing, fishing,
--   freediving, kitesurfing, hiking, cycling, motorbike_touring, rock_climbing,
--   canyoning, paragliding, yoga, meditation, spa_massage, sound_healing,
--   detox, breathwork, cooking_classes, market_visits, food_tours,
--   temples_ceremonies, traditional_arts, wildlife, marine_life, volcanoes
-- food operators: indonesian, western, japanese, halal, vegetarian, vegan,
--   gluten_free, warung, fine_dining, street_food, coffee, bar
-- accommodation operators: private_villa, boutique_hotel, resort, homestay,
--   hostel, eco_lodge, liveaboard, surf_camp, yoga_retreat,
--   private_pool, beach_access, fast_wifi, child_friendly, pet_friendly
-- transport operators: hire_driver, motorbike_rental, boat_charter, airport_transfer

-- GIN index for tag matching
CREATE INDEX IF NOT EXISTS idx_operators_tags ON operators USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_operators_price_level ON operators(price_level);

-- Recommendation cache - store scored results per member for 1 hour
CREATE TABLE IF NOT EXISTS recommendation_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(50),
  region VARCHAR(100),
  results JSONB NOT NULL,
  score_breakdown JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour',
  UNIQUE(user_id, category, region)
);

CREATE INDEX IF NOT EXISTS idx_rec_cache_user ON recommendation_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_rec_cache_expires ON recommendation_cache(expires_at);

-- Member affinity scores - track what members engage with for future ML
CREATE TABLE IF NOT EXISTS member_interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL, -- 'operator', 'place', 'region'
  entity_id VARCHAR(255) NOT NULL,  -- operator id or place cache id
  interaction_type VARCHAR(20) NOT NULL, -- 'view', 'save', 'book', 'review', 'share'
  region VARCHAR(100),
  category VARCHAR(50),
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interactions_user ON member_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_interactions_entity ON member_interactions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_interactions_type ON member_interactions(interaction_type);

-- Saved operators/places (bookmarks)
CREATE TABLE IF NOT EXISTS member_saves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL, -- 'operator' or 'place'
  entity_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_saves_user ON member_saves(user_id);

COMMENT ON TABLE recommendation_cache IS 'Cached recommendation results per member. Expires hourly.';
COMMENT ON TABLE member_interactions IS 'Member engagement events for recommendation improvement.';
COMMENT ON TABLE member_saves IS 'Bookmarked operators and places.';
