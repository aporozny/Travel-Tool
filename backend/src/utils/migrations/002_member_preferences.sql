-- Migration 002: Deep member preference schema
-- Replaces the shallow traveler_preferences table with a comprehensive structure

-- Drop old shallow preferences table
DROP TABLE IF EXISTS traveler_preferences CASCADE;

-- ----------------------------------------------------------------
-- MEMBER PREFERENCES - comprehensive preference profile
-- Stored as typed columns for queryability and validation
-- JSONB used where arrays of enum values are needed
-- ----------------------------------------------------------------

CREATE TABLE member_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  traveler_id UUID UNIQUE NOT NULL REFERENCES travelers(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- IDENTITY & TRAVEL PERSONA
  travel_style TEXT[] DEFAULT '{}',
  -- values: solo, couple, family_with_kids, group_of_friends, digital_nomad, honeymoon, work_trip

  trip_length_preference VARCHAR(30),
  -- values: weekend, short_break, two_weeks, month_plus, extended

  travel_frequency VARCHAR(30),
  -- values: once_a_year, two_to_four_times, monthly, constantly

  sea_experience_level VARCHAR(30),
  -- values: first_time, been_once_or_twice, seasoned, expat

  work_situation VARCHAR(30),
  -- values: pure_holiday, remote_worker, digital_nomad, relocating, bleisure

  travel_pace VARCHAR(30),
  -- values: packed, balanced, slow, spontaneous

  social_preference VARCHAR(30),
  -- values: meet_locals, meet_travellers, mix, prefer_privacy

  languages_spoken TEXT[] DEFAULT '{}',

  -- BUDGET & SPENDING
  budget_range VARCHAR(30),
  -- values: budget, mid, upper_mid, luxury, ultra_luxury

  accommodation_budget_aud VARCHAR(20),
  -- values: under_30, 30_to_80, 80_to_200, 200_to_500, 500_plus

  splurge_categories TEXT[] DEFAULT '{}',
  -- values: experiences, food, accommodation, spa, photography, nothing

  payment_preference VARCHAR(20),
  -- values: cash, card, either

  eco_spend_willingness VARCHAR(30),
  -- values: will_pay_more, only_if_same_price, not_a_factor

  -- ACCOMMODATION
  accommodation_types TEXT[] DEFAULT '{}',
  -- values: private_villa, boutique_hotel, resort, homestay, hostel,
  --         airbnb, eco_lodge, liveaboard, surf_camp, yoga_retreat

  accommodation_must_haves TEXT[] DEFAULT '{}',
  -- values: private_pool, air_conditioning, fast_wifi, kitchen,
  --         gym, beach_access, nature_view, pet_friendly, child_friendly

  accommodation_deal_breakers TEXT[] DEFAULT '{}',
  -- values: shared_bathrooms, no_ac, no_wifi, noisy, far_from_town

  location_preference TEXT[] DEFAULT '{}',
  -- values: beach_front, central, quiet_remote, rice_fields,
  --         near_surf, near_dive_sites

  stay_length_preference VARCHAR(30),
  -- values: move_frequently, base_and_explore, one_place

  -- FOOD & DINING
  dietary_requirements TEXT[] DEFAULT '{}',
  -- values: none, vegetarian, vegan, halal, gluten_free, dairy_free,
  --         nut_allergy, shellfish_allergy, pescatarian, kosher, jain

  food_adventurousness VARCHAR(30),
  -- values: eat_anything, adventurous_some_limits, mostly_familiar, strict

  spice_tolerance VARCHAR(20),
  -- values: very_spicy, medium, mild, none

  cuisine_preferences TEXT[] DEFAULT '{}',
  -- values: indonesian, western, japanese, indian, mexican,
  --         mediterranean, chinese, thai_sea, middle_eastern, raw_plant

  dining_style VARCHAR(30),
  -- values: warung, casual, fine_dining_occasionally, mix, street_food

  coffee_preference VARCHAR(30),
  -- values: specialty_essential, coffee_not_fussy, tea_drinker, not_a_coffee_person

  alcohol_preference VARCHAR(30),
  -- values: socially, regularly, rarely, non_drinker, non_drinker_religious

  meal_timing VARCHAR(30),
  -- values: early_riser, standard, late_nights, skip_breakfast

  food_experiences TEXT[] DEFAULT '{}',
  -- values: cooking_classes, market_visits, farm_to_table,
  --         tasting_menus, food_tours, fermentation

  -- ACTIVITIES & INTERESTS
  water_activities TEXT[] DEFAULT '{}',
  -- values: scuba_diving, snorkeling, surfing, sup, sailing,
  --         fishing, rafting, swimming, freediving, kitesurfing

  land_activities TEXT[] DEFAULT '{}',
  -- values: hiking, cycling, motorbike_touring, rock_climbing,
  --         canyoning, paragliding, atv, running

  wellness_interests TEXT[] DEFAULT '{}',
  -- values: yoga, meditation, spa_massage, sound_healing, detox,
  --         breathwork, ayurveda, cold_exposure

  cultural_interests TEXT[] DEFAULT '{}',
  -- values: temples_ceremonies, traditional_arts, language_learning,
  --         history_heritage, local_community, photography_art, music_festivals

  nightlife_preference VARCHAR(30),
  -- values: love_it, occasional, prefer_quiet, none

  adrenaline_level VARCHAR(20),
  -- values: low, medium, high, extreme

  nature_interests TEXT[] DEFAULT '{}',
  -- values: wildlife, birdwatching, marine_life, volcanoes,
  --         waterfalls, jungles, stargazing

  creative_interests TEXT[] DEFAULT '{}',
  -- values: photography, videography, painting, writing, craft

  animal_ethics VARCHAR(30),
  -- values: love_encounters, ethical_only, not_interested

  volunteering_interest VARCHAR(20),
  -- values: yes, maybe, not_on_this_trip

  -- LIFESTYLE & VALUES
  sustainability_commitment VARCHAR(30),
  -- values: very_important, important_not_always, aware_not_priority, not_a_factor

  carbon_offset_attitude VARCHAR(20),
  -- values: always, sometimes, never_considered

  shopping_preference VARCHAR(30),
  -- values: local_artisan, minimal, mix, not_a_shopper

  fitness_level VARCHAR(20),
  -- values: very_active, moderately_fit, average, limited_mobility, recovering

  connectivity_needs VARCHAR(30),
  -- values: need_fast_always, need_wifi_slow_ok, wifi_nice_can_disconnect, prefer_disconnect

  spiritual_practice VARCHAR(30),
  -- values: active_shapes_decisions, spiritual_not_religious, culturally_interested, not_relevant

  values_influence_travel VARCHAR(20),
  -- values: strongly, somewhat, not_at_all

  lgbtq_considerations VARCHAR(30),
  -- values: important_need_welcoming, aware_flexible, not_a_factor

  -- TRANSPORT & LOGISTICS
  transport_preference TEXT[] DEFAULT '{}',
  -- values: ride_motorbike, motorbike_passenger, hire_driver,
  --         public_transport, walking_cycling_only

  has_driving_licence BOOLEAN,

  island_hopping_appetite VARCHAR(30),
  -- values: love_moving, one_base_day_trips, stay_one_place

  domestic_flight_comfort VARCHAR(30),
  -- values: fly_happily, prefer_boat, avoid_flying

  luggage_style VARCHAR(20),
  -- values: backpack_only, carry_on_only, full_luggage

  -- INDONESIAN ISLANDS
  regions_visited TEXT[] DEFAULT '{}',
  bucket_list_regions TEXT[] DEFAULT '{}',
  bali_areas_interest TEXT[] DEFAULT '{}',

  next_trip_timing VARCHAR(30),
  -- values: planning_now, next_6_months, within_a_year, just_dreaming, already_here

  -- COMMUNITY
  community_participation TEXT[] DEFAULT '{}',
  -- values: share_reports, ask_questions, meet_members,
  --         find_travel_buddies, lurk

  content_sharing_comfort VARCHAR(30),
  -- values: happy_to_share, tips_not_photos, private

  travel_buddy_preferences TEXT[] DEFAULT '{}',
  -- values: same_gender, similar_age, similar_budget, same_activities, any

  notification_preferences TEXT[] DEFAULT '{}',
  -- values: new_members_region, events_near_me, new_operators,
  --         trip_reports, minimal

  referral_source VARCHAR(30),
  -- values: instagram, friend_referral, google, facebook_group, reddit, other

  -- ONBOARDING TRACKING
  onboarding_completed BOOLEAN DEFAULT false,
  onboarding_step INTEGER DEFAULT 0,
  -- 0=not started, 1-9=in progress (9 categories), 10=complete
  onboarding_completed_at TIMESTAMPTZ
);

-- Indexes for preference-based matching
CREATE INDEX idx_member_prefs_traveler ON member_preferences(traveler_id);
CREATE INDEX idx_member_prefs_budget ON member_preferences(budget_range);
CREATE INDEX idx_member_prefs_onboarding ON member_preferences(onboarding_completed, onboarding_step);
CREATE INDEX idx_member_prefs_next_trip ON member_preferences(next_trip_timing);

-- GIN indexes for array columns used in operator matching
CREATE INDEX idx_member_prefs_water ON member_preferences USING GIN(water_activities);
CREATE INDEX idx_member_prefs_land ON member_preferences USING GIN(land_activities);
CREATE INDEX idx_member_prefs_wellness ON member_preferences USING GIN(wellness_interests);
CREATE INDEX idx_member_prefs_dietary ON member_preferences USING GIN(dietary_requirements);
CREATE INDEX idx_member_prefs_regions ON member_preferences USING GIN(bucket_list_regions);
CREATE INDEX idx_member_prefs_accommodation ON member_preferences USING GIN(accommodation_types);

-- Create preferences record automatically when traveler is created
CREATE OR REPLACE FUNCTION create_member_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO member_preferences (id, traveler_id)
  VALUES (gen_random_uuid(), NEW.id)
  ON CONFLICT (traveler_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_member_preferences
  AFTER INSERT ON travelers
  FOR EACH ROW EXECUTE FUNCTION create_member_preferences();

-- Backfill preferences for existing travelers
INSERT INTO member_preferences (id, traveler_id)
SELECT gen_random_uuid(), t.id
FROM travelers t
WHERE NOT EXISTS (
  SELECT 1 FROM member_preferences mp WHERE mp.traveler_id = t.id
);

COMMENT ON TABLE member_preferences IS
  'Deep member preference profile. 49 dimensions across 9 categories.
   All text[] columns use lowercase underscore values documented inline.
   Populated progressively through onboarding flow.';
