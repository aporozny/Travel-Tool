import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../src/utils/db';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const PASSWORD_HASH = bcrypt.hashSync('DriftTest2026!', 12);

const MEMBERS = [
  {
    email: 'sarah.chen@drifttest.com',
    first_name: 'Sarah', last_name: 'Chen',
    home_city: 'Melbourne', home_country: 'Australia',
    prefs: {
      travel_style: ['solo', 'digital_nomad'],
      budget_range: 'mid',
      accommodation_budget_aud: '80_to_200',
      accommodation_types: ['boutique_hotel', 'airbnb', 'yoga_retreat'],
      accommodation_must_haves: ['fast_wifi', 'air_conditioning'],
      dietary_requirements: ['vegetarian'],
      food_adventurousness: 'adventurous_some_limits',
      spice_tolerance: 'medium',
      cuisine_preferences: ['indonesian', 'japanese', 'raw_plant'],
      dining_style: 'mix',
      water_activities: ['snorkeling', 'sup', 'swimming'],
      land_activities: ['hiking', 'cycling'],
      wellness_interests: ['yoga', 'meditation', 'spa_massage'],
      cultural_interests: ['temples_ceremonies', 'traditional_arts'],
      adrenaline_level: 'low',
      nightlife_preference: 'prefer_quiet',
      sustainability_commitment: 'very_important',
      fitness_level: 'very_active',
      connectivity_needs: 'need_fast_always',
      travel_pace: 'slow',
      social_preference: 'meet_locals',
      sea_experience_level: 'seasoned',
      work_situation: 'digital_nomad',
      transport_preference: ['hire_driver', 'motorbike_passenger'],
      bucket_list_regions: ['ubud', 'nusa_penida', 'lombok', 'flores'],
      bali_areas_interest: ['ubud', 'canggu', 'sidemen'],
      next_trip_timing: 'planning_now',
      community_participation: ['share_reports', 'ask_questions', 'meet_members'],
      content_sharing_comfort: 'happy_to_share',
      referral_source: 'instagram',
    }
  },
  {
    email: 'jake.morrison@drifttest.com',
    first_name: 'Jake', last_name: 'Morrison',
    home_city: 'Sydney', home_country: 'Australia',
    prefs: {
      travel_style: ['couple'],
      budget_range: 'upper_mid',
      accommodation_budget_aud: '200_to_500',
      accommodation_types: ['private_villa', 'boutique_hotel'],
      accommodation_must_haves: ['private_pool', 'beach_access', 'air_conditioning'],
      dietary_requirements: ['none'],
      food_adventurousness: 'eat_anything',
      spice_tolerance: 'very_spicy',
      cuisine_preferences: ['indonesian', 'western', 'thai_sea'],
      dining_style: 'mix',
      alcohol_preference: 'socially',
      water_activities: ['scuba_diving', 'snorkeling', 'freediving', 'surfing'],
      land_activities: ['hiking', 'motorbike_touring'],
      wellness_interests: ['spa_massage'],
      adrenaline_level: 'high',
      nightlife_preference: 'occasional',
      sustainability_commitment: 'important_not_always',
      fitness_level: 'very_active',
      connectivity_needs: 'wifi_nice_can_disconnect',
      travel_pace: 'balanced',
      sea_experience_level: 'seasoned',
      work_situation: 'pure_holiday',
      transport_preference: ['ride_motorbike', 'hire_driver'],
      has_driving_licence: true,
      island_hopping_appetite: 'love_moving',
      bucket_list_regions: ['raja_ampat', 'flores', 'komodo', 'nusa_penida'],
      bali_areas_interest: ['uluwatu', 'amed', 'nusa_penida'],
      next_trip_timing: 'next_6_months',
      community_participation: ['ask_questions', 'find_travel_buddies'],
      content_sharing_comfort: 'tips_not_photos',
      referral_source: 'friend_referral',
    }
  },
  {
    email: 'priya.sharma@drifttest.com',
    first_name: 'Priya', last_name: 'Sharma',
    home_city: 'Brisbane', home_country: 'Australia',
    prefs: {
      travel_style: ['solo', 'group_of_friends'],
      budget_range: 'budget',
      accommodation_budget_aud: '30_to_80',
      accommodation_types: ['hostel', 'homestay', 'airbnb'],
      accommodation_must_haves: ['fast_wifi', 'air_conditioning'],
      dietary_requirements: ['vegetarian', 'halal'],
      food_adventurousness: 'adventurous_some_limits',
      spice_tolerance: 'very_spicy',
      cuisine_preferences: ['indonesian', 'indian', 'middle_eastern'],
      dining_style: 'warung',
      alcohol_preference: 'non_drinker_religious',
      water_activities: ['snorkeling', 'swimming', 'surfing'],
      land_activities: ['hiking', 'cycling', 'running'],
      cultural_interests: ['temples_ceremonies', 'local_community', 'history_heritage'],
      adrenaline_level: 'medium',
      nightlife_preference: 'none',
      sustainability_commitment: 'very_important',
      fitness_level: 'very_active',
      connectivity_needs: 'need_wifi_slow_ok',
      travel_pace: 'slow',
      sea_experience_level: 'been_once_or_twice',
      work_situation: 'pure_holiday',
      transport_preference: ['public_transport', 'walking_cycling_only'],
      bucket_list_regions: ['bali', 'lombok', 'gili_islands', 'java'],
      bali_areas_interest: ['ubud', 'sanur', 'seminyak'],
      next_trip_timing: 'planning_now',
      community_participation: ['share_reports', 'ask_questions', 'find_travel_buddies'],
      content_sharing_comfort: 'happy_to_share',
      referral_source: 'google',
    }
  },
  {
    email: 'tom.walsh@drifttest.com',
    first_name: 'Tom', last_name: 'Walsh',
    home_city: 'Perth', home_country: 'Australia',
    prefs: {
      travel_style: ['solo'],
      budget_range: 'mid',
      accommodation_budget_aud: '80_to_200',
      accommodation_types: ['surf_camp', 'hostel', 'airbnb'],
      accommodation_must_haves: ['near_surf', 'fast_wifi'],
      dietary_requirements: ['none'],
      food_adventurousness: 'eat_anything',
      spice_tolerance: 'medium',
      dining_style: 'warung',
      alcohol_preference: 'socially',
      water_activities: ['surfing', 'sup', 'swimming', 'snorkeling'],
      land_activities: ['cycling', 'running', 'hiking'],
      adrenaline_level: 'high',
      nightlife_preference: 'occasional',
      sustainability_commitment: 'aware_not_priority',
      fitness_level: 'very_active',
      connectivity_needs: 'wifi_nice_can_disconnect',
      travel_pace: 'spontaneous',
      sea_experience_level: 'seasoned',
      work_situation: 'digital_nomad',
      transport_preference: ['ride_motorbike', 'walking_cycling_only'],
      has_driving_licence: true,
      island_hopping_appetite: 'love_moving',
      bucket_list_regions: ['lombok', 'gili_islands', 'flores'],
      bali_areas_interest: ['canggu', 'uluwatu', 'seminyak'],
      next_trip_timing: 'already_here',
      community_participation: ['meet_members', 'find_travel_buddies', 'share_reports'],
      content_sharing_comfort: 'happy_to_share',
      referral_source: 'instagram',
    }
  },
  {
    email: 'emma.jones@drifttest.com',
    first_name: 'Emma', last_name: 'Jones',
    home_city: 'London', home_country: 'UK',
    prefs: {
      travel_style: ['couple', 'honeymoon'],
      budget_range: 'luxury',
      accommodation_budget_aud: '500_plus',
      accommodation_types: ['private_villa', 'resort', 'boutique_hotel'],
      accommodation_must_haves: ['private_pool', 'beach_access', 'air_conditioning', 'fast_wifi'],
      dietary_requirements: ['gluten_free'],
      food_adventurousness: 'mostly_familiar',
      spice_tolerance: 'mild',
      cuisine_preferences: ['western', 'japanese', 'mediterranean'],
      dining_style: 'fine_dining_occasionally',
      alcohol_preference: 'socially',
      water_activities: ['snorkeling', 'swimming', 'sailing'],
      land_activities: ['hiking'],
      wellness_interests: ['spa_massage', 'yoga', 'sound_healing'],
      cultural_interests: ['temples_ceremonies', 'photography_art'],
      adrenaline_level: 'low',
      nightlife_preference: 'prefer_quiet',
      sustainability_commitment: 'important_not_always',
      eco_spend_willingness: 'will_pay_more',
      fitness_level: 'moderately_fit',
      connectivity_needs: 'need_wifi_slow_ok',
      travel_pace: 'slow',
      sea_experience_level: 'been_once_or_twice',
      work_situation: 'pure_holiday',
      transport_preference: ['hire_driver'],
      island_hopping_appetite: 'one_base_day_trips',
      bucket_list_regions: ['bali', 'nusa_penida', 'lombok'],
      bali_areas_interest: ['ubud', 'seminyak', 'nusa_penida'],
      next_trip_timing: 'next_6_months',
      community_participation: ['ask_questions', 'share_reports'],
      content_sharing_comfort: 'tips_not_photos',
      referral_source: 'friend_referral',
    }
  },
  {
    email: 'marcus.lee@drifttest.com',
    first_name: 'Marcus', last_name: 'Lee',
    home_city: 'Singapore', home_country: 'Singapore',
    prefs: {
      travel_style: ['group_of_friends'],
      budget_range: 'upper_mid',
      accommodation_budget_aud: '200_to_500',
      accommodation_types: ['private_villa', 'boutique_hotel'],
      accommodation_must_haves: ['private_pool', 'air_conditioning'],
      dietary_requirements: ['none'],
      food_adventurousness: 'eat_anything',
      spice_tolerance: 'very_spicy',
      cuisine_preferences: ['indonesian', 'chinese', 'thai_sea', 'western'],
      dining_style: 'mix',
      alcohol_preference: 'regularly',
      water_activities: ['scuba_diving', 'snorkeling', 'sailing', 'freediving'],
      land_activities: ['motorbike_touring', 'hiking'],
      adrenaline_level: 'extreme',
      nightlife_preference: 'love_it',
      sustainability_commitment: 'aware_not_priority',
      fitness_level: 'very_active',
      connectivity_needs: 'need_fast_always',
      travel_pace: 'packed',
      sea_experience_level: 'seasoned',
      work_situation: 'pure_holiday',
      transport_preference: ['ride_motorbike', 'hire_driver'],
      has_driving_licence: true,
      island_hopping_appetite: 'love_moving',
      bucket_list_regions: ['raja_ampat', 'komodo', 'flores', 'sulawesi'],
      bali_areas_interest: ['seminyak', 'canggu', 'uluwatu', 'amed'],
      next_trip_timing: 'planning_now',
      community_participation: ['meet_members', 'find_travel_buddies', 'share_reports'],
      content_sharing_comfort: 'happy_to_share',
      referral_source: 'instagram',
    }
  },
  {
    email: 'lisa.nakamura@drifttest.com',
    first_name: 'Lisa', last_name: 'Nakamura',
    home_city: 'Tokyo', home_country: 'Japan',
    prefs: {
      travel_style: ['solo'],
      budget_range: 'mid',
      accommodation_budget_aud: '80_to_200',
      accommodation_types: ['boutique_hotel', 'homestay', 'eco_lodge'],
      accommodation_must_haves: ['air_conditioning', 'nature_view'],
      dietary_requirements: ['none'],
      food_adventurousness: 'eat_anything',
      spice_tolerance: 'medium',
      cuisine_preferences: ['indonesian', 'japanese', 'thai_sea'],
      dining_style: 'mix',
      water_activities: ['scuba_diving', 'snorkeling', 'freediving'],
      land_activities: ['hiking', 'cycling'],
      wellness_interests: ['yoga', 'meditation'],
      cultural_interests: ['temples_ceremonies', 'traditional_arts', 'photography_art'],
      nature_interests: ['marine_life', 'wildlife', 'jungles'],
      adrenaline_level: 'medium',
      nightlife_preference: 'prefer_quiet',
      sustainability_commitment: 'very_important',
      animal_ethics: 'ethical_only',
      fitness_level: 'very_active',
      connectivity_needs: 'wifi_nice_can_disconnect',
      travel_pace: 'slow',
      sea_experience_level: 'seasoned',
      work_situation: 'pure_holiday',
      transport_preference: ['hire_driver', 'motorbike_passenger'],
      island_hopping_appetite: 'love_moving',
      bucket_list_regions: ['raja_ampat', 'flores', 'komodo', 'sulawesi'],
      bali_areas_interest: ['ubud', 'amed', 'nusa_penida'],
      next_trip_timing: 'within_a_year',
      community_participation: ['share_reports', 'ask_questions'],
      content_sharing_comfort: 'happy_to_share',
      referral_source: 'google',
    }
  },
  {
    email: 'ben.carter@drifttest.com',
    first_name: 'Ben', last_name: 'Carter',
    home_city: 'Auckland', home_country: 'New Zealand',
    prefs: {
      travel_style: ['solo', 'group_of_friends'],
      budget_range: 'budget',
      accommodation_budget_aud: 'under_30',
      accommodation_types: ['hostel', 'surf_camp', 'homestay'],
      dietary_requirements: ['none'],
      food_adventurousness: 'eat_anything',
      spice_tolerance: 'medium',
      dining_style: 'warung',
      alcohol_preference: 'socially',
      water_activities: ['surfing', 'snorkeling', 'swimming', 'kitesurfing'],
      land_activities: ['hiking', 'cycling', 'rock_climbing'],
      adrenaline_level: 'extreme',
      nightlife_preference: 'occasional',
      sustainability_commitment: 'aware_not_priority',
      fitness_level: 'very_active',
      connectivity_needs: 'wifi_nice_can_disconnect',
      travel_pace: 'spontaneous',
      sea_experience_level: 'seasoned',
      work_situation: 'digital_nomad',
      transport_preference: ['ride_motorbike', 'public_transport'],
      has_driving_licence: true,
      island_hopping_appetite: 'love_moving',
      bucket_list_regions: ['lombok', 'gili_islands', 'flores', 'sumatra'],
      bali_areas_interest: ['canggu', 'uluwatu', 'seminyak'],
      next_trip_timing: 'planning_now',
      community_participation: ['find_travel_buddies', 'meet_members', 'share_reports'],
      content_sharing_comfort: 'happy_to_share',
      referral_source: 'reddit',
    }
  },
];

async function seedMember(member: typeof MEMBERS[0]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if already exists
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [member.email]);
    if (existing.rows.length > 0) {
      console.log(`  ⟳ ${member.first_name} ${member.last_name} already exists`);
      await client.query('ROLLBACK');
      return;
    }

    // Create user
    const userId = uuidv4();
    await client.query(
      'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [userId, member.email, PASSWORD_HASH, 'traveler']
    );

    // Create traveler profile
    const travelerId = uuidv4();
    await client.query(
      `INSERT INTO travelers (id, user_id, first_name, last_name, home_city, home_country, show_in_directory)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [travelerId, userId, member.first_name, member.last_name, member.home_city, member.home_country]
    );

    // Create preferences
    const p = member.prefs as any;
    await client.query(
      `INSERT INTO member_preferences (
         id, traveler_id,
         travel_style, budget_range, accommodation_budget_aud, accommodation_types,
         accommodation_must_haves, dietary_requirements, food_adventurousness,
         spice_tolerance, cuisine_preferences, dining_style, alcohol_preference,
         water_activities, land_activities, wellness_interests, cultural_interests,
         nature_interests, adrenaline_level, nightlife_preference,
         sustainability_commitment, eco_spend_willingness, animal_ethics,
         fitness_level, connectivity_needs, travel_pace, social_preference,
         sea_experience_level, work_situation, transport_preference,
         has_driving_licence, island_hopping_appetite,
         bucket_list_regions, bali_areas_interest, next_trip_timing,
         community_participation, content_sharing_comfort, referral_source,
         onboarding_completed, onboarding_step, onboarding_completed_at
       ) VALUES (
         gen_random_uuid(), $1,
         $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
         $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
         true, 10, NOW()
       )`,
      [
        travelerId,
        p.travel_style || [], p.budget_range || null, p.accommodation_budget_aud || null,
        p.accommodation_types || [], p.accommodation_must_haves || [],
        p.dietary_requirements || [], p.food_adventurousness || null,
        p.spice_tolerance || null, p.cuisine_preferences || [], p.dining_style || null,
        p.alcohol_preference || null, p.water_activities || [], p.land_activities || [],
        p.wellness_interests || [], p.cultural_interests || [], p.nature_interests || [],
        p.adrenaline_level || null, p.nightlife_preference || null,
        p.sustainability_commitment || null, p.eco_spend_willingness || null,
        p.animal_ethics || null, p.fitness_level || null, p.connectivity_needs || null,
        p.travel_pace || null, p.social_preference || null, p.sea_experience_level || null,
        p.work_situation || null, p.transport_preference || [],
        p.has_driving_licence !== undefined ? p.has_driving_licence : null,
        p.island_hopping_appetite || null,
        p.bucket_list_regions || [], p.bali_areas_interest || [],
        p.next_trip_timing || null, p.community_participation || [],
        p.content_sharing_comfort || null, p.referral_source || null,
      ]
    );

    await client.query('COMMIT');
    console.log(`  ✓ ${member.first_name} ${member.last_name} (${member.home_city})`);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error(`  ✗ ${member.first_name}: ${err.message}`);
  } finally {
    client.release();
  }
}

async function main() {
  console.log('Seeding test members...\n');
  for (const member of MEMBERS) {
    await seedMember(member);
  }

  const count = await pool.query('SELECT COUNT(*) FROM users WHERE role = $1', ['traveler']);
  console.log(`\nTotal travelers in DB: ${count.rows[0].count}`);

  // Show directory-eligible members
  const eligible = await pool.query(`
    SELECT t.first_name, t.last_name, t.home_city, mp.next_trip_timing, mp.budget_range
    FROM travelers t
    JOIN member_preferences mp ON mp.traveler_id = t.id
    WHERE mp.onboarding_completed = true AND t.show_in_directory = true
    ORDER BY mp.next_trip_timing
  `);
  console.log('\nDirectory-eligible members:');
  for (const r of eligible.rows) {
    console.log(`  ${(r.first_name + ' ' + r.last_name).padEnd(20)} ${(r.home_city || '').padEnd(15)} ${r.next_trip_timing}`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
