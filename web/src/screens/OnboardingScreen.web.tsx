import React, { useState } from 'react';
import api from '../services/api.web';

interface StepProps {
  onNext: (data: any) => void;
  onBack: () => void;
  step: number;
  total: number;
}

const STEPS = [
  'Who you are',
  'Your budget',
  'Where you sleep',
  'Food & drink',
  'Activities',
  'How you live',
  'Getting around',
  'Indonesian islands',
  'Community',
];

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div style={styles.progress}>
      <div style={styles.progressBar}>
        <div style={{ ...styles.progressFill, width: `${((step) / total) * 100}%` }} />
      </div>
      <p style={styles.progressText}>{step} of {total}</p>
    </div>
  );
}

function OptionCard({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ ...styles.optionCard, ...(selected ? styles.optionCardSelected : {}) }}>
      <span style={styles.optionLabel}>{label}</span>
      {selected && <span style={styles.optionCheck}>✓</span>}
    </button>
  );
}

function Step1({ onNext }: StepProps) {
  const [data, setData] = useState<any>({ travel_style: [], travel_pace: '', social_preference: '', sea_experience_level: '', work_situation: '' });
  const toggle = (field: string, val: string) => {
    setData((p: any) => ({ ...p, [field]: p[field].includes(val) ? p[field].filter((v: string) => v !== val) : [...p[field], val] }));
  };
  const set = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field] === val ? '' : val }));

  return (
    <div style={styles.step}>
      <h2 style={styles.stepTitle}>How do you travel?</h2>
      <p style={styles.stepSub}>Select all that apply</p>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>I travel as</p>
        <div style={styles.grid}>
          {[['solo', 'Solo'], ['couple', 'Couple'], ['family_with_kids', 'Family with kids'], ['group_of_friends', 'Group of friends'], ['digital_nomad', 'Digital nomad'], ['honeymoon', 'Honeymoon']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.travel_style.includes(v)} onClick={() => toggle('travel_style', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>My travel pace</p>
        <div style={styles.grid}>
          {[['packed', 'Packed itinerary'], ['balanced', 'Balanced'], ['slow', 'Slow travel'], ['spontaneous', 'Spontaneous']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.travel_pace === v} onClick={() => set('travel_pace', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Experience in Southeast Asia</p>
        <div style={styles.grid}>
          {[['first_time', 'First time'], ['been_once_or_twice', 'Been once or twice'], ['seasoned', 'Seasoned traveller'], ['expat', 'Living here / expat']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.sea_experience_level === v} onClick={() => set('sea_experience_level', v)} />
          ))}
        </div>
      </div>

      <button style={styles.nextBtn} onClick={() => onNext(data)}>Continue</button>
    </div>
  );
}

function Step2({ onNext, onBack }: StepProps) {
  const [data, setData] = useState<any>({ budget_range: '', accommodation_budget_aud: '', splurge_categories: [], eco_spend_willingness: '' });
  const toggle = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field].includes(val) ? p[field].filter((v: string) => v !== val) : [...p[field], val] }));
  const set = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field] === val ? '' : val }));

  return (
    <div style={styles.step}>
      <h2 style={styles.stepTitle}>Budget & spending</h2>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Overall daily budget</p>
        <div style={styles.grid}>
          {[['budget', 'Budget — under $50/day'], ['mid', 'Mid — $50–150/day'], ['upper_mid', 'Upper mid — $150–300/day'], ['luxury', 'Luxury — $300+/day'], ['ultra_luxury', 'Ultra luxury']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.budget_range === v} onClick={() => set('budget_range', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Accommodation budget per night (AUD)</p>
        <div style={styles.grid}>
          {[['under_30', 'Under $30'], ['30_to_80', '$30–80'], ['80_to_200', '$80–200'], ['200_to_500', '$200–500'], ['500_plus', '$500+']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.accommodation_budget_aud === v} onClick={() => set('accommodation_budget_aud', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>I'll happily splurge on</p>
        <div style={styles.grid}>
          {[['experiences', 'Experiences'], ['food', 'Food & dining'], ['accommodation', 'Accommodation'], ['spa', 'Spa & wellness'], ['photography', 'Photography / gear'], ['nothing', 'Nothing — strict budget']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.splurge_categories.includes(v)} onClick={() => toggle('splurge_categories', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Sustainability & spending</p>
        <div style={styles.grid}>
          {[['will_pay_more', 'Will pay more for eco options'], ['only_if_same_price', 'Only if same price'], ['not_a_factor', 'Not a factor']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.eco_spend_willingness === v} onClick={() => set('eco_spend_willingness', v)} />
          ))}
        </div>
      </div>

      <div style={styles.btnRow}>
        <button style={styles.backBtn} onClick={onBack}>Back</button>
        <button style={styles.nextBtn} onClick={() => onNext(data)}>Continue</button>
      </div>
    </div>
  );
}

function Step3({ onNext, onBack }: StepProps) {
  const [data, setData] = useState<any>({ accommodation_types: [], accommodation_must_haves: [], accommodation_deal_breakers: [], location_preference: [], stay_length_preference: '' });
  const toggle = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field].includes(val) ? p[field].filter((v: string) => v !== val) : [...p[field], val] }));
  const set = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field] === val ? '' : val }));

  return (
    <div style={styles.step}>
      <h2 style={styles.stepTitle}>Where you sleep</h2>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Accommodation types I love</p>
        <div style={styles.grid}>
          {[['private_villa', 'Private villa'], ['boutique_hotel', 'Boutique hotel'], ['resort', 'Resort'], ['homestay', 'Homestay / guesthouse'], ['hostel', 'Hostel / dorm'], ['airbnb', 'Airbnb / apartment'], ['eco_lodge', 'Eco lodge'], ['liveaboard', 'Liveaboard'], ['surf_camp', 'Surf camp'], ['yoga_retreat', 'Yoga retreat']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.accommodation_types.includes(v)} onClick={() => toggle('accommodation_types', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Must-haves</p>
        <div style={styles.grid}>
          {[['private_pool', 'Private pool'], ['air_conditioning', 'Air conditioning'], ['fast_wifi', 'Fast wifi'], ['kitchen', 'Kitchen'], ['beach_access', 'Beach access'], ['nature_view', 'Rice field / nature view'], ['pet_friendly', 'Pet friendly'], ['child_friendly', 'Child friendly']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.accommodation_must_haves.includes(v)} onClick={() => toggle('accommodation_must_haves', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Location preference</p>
        <div style={styles.grid}>
          {[['beach_front', 'Beach front'], ['central', 'Central / walkable'], ['quiet_remote', 'Quiet / remote'], ['rice_fields', 'Rice fields / jungle'], ['near_surf', 'Near surf breaks'], ['near_dive_sites', 'Near dive sites']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.location_preference.includes(v)} onClick={() => toggle('location_preference', v)} />
          ))}
        </div>
      </div>

      <div style={styles.btnRow}>
        <button style={styles.backBtn} onClick={onBack}>Back</button>
        <button style={styles.nextBtn} onClick={() => onNext(data)}>Continue</button>
      </div>
    </div>
  );
}

function Step4({ onNext, onBack }: StepProps) {
  const [data, setData] = useState<any>({ dietary_requirements: [], food_adventurousness: '', spice_tolerance: '', cuisine_preferences: [], dining_style: '', alcohol_preference: '', food_experiences: [] });
  const toggle = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field].includes(val) ? p[field].filter((v: string) => v !== val) : [...p[field], val] }));
  const set = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field] === val ? '' : val }));

  return (
    <div style={styles.step}>
      <h2 style={styles.stepTitle}>Food & drink</h2>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Dietary requirements</p>
        <div style={styles.grid}>
          {[['none', 'No restrictions'], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan'], ['halal', 'Halal'], ['gluten_free', 'Gluten free'], ['dairy_free', 'Dairy free'], ['nut_allergy', 'Nut allergy'], ['shellfish_allergy', 'Shellfish allergy'], ['pescatarian', 'Pescatarian'], ['kosher', 'Kosher']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.dietary_requirements.includes(v)} onClick={() => toggle('dietary_requirements', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Food adventurousness</p>
        <div style={styles.grid}>
          {[['eat_anything', 'Eat absolutely anything'], ['adventurous_some_limits', 'Adventurous — some limits'], ['mostly_familiar', 'Mostly familiar food'], ['strict', 'Strict / very selective']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.food_adventurousness === v} onClick={() => set('food_adventurousness', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Spice tolerance</p>
        <div style={styles.grid}>
          {[['very_spicy', 'Love it very spicy'], ['medium', 'Medium spice fine'], ['mild', 'Mild only'], ['none', 'No spice at all']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.spice_tolerance === v} onClick={() => set('spice_tolerance', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Cuisine preferences</p>
        <div style={styles.grid}>
          {[['indonesian', 'Indonesian / Balinese'], ['western', 'Western'], ['japanese', 'Japanese'], ['indian', 'Indian'], ['mexican', 'Mexican'], ['mediterranean', 'Mediterranean'], ['chinese', 'Chinese'], ['thai_sea', 'Thai / SEA'], ['middle_eastern', 'Middle Eastern'], ['raw_plant', 'Raw / plant based']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.cuisine_preferences.includes(v)} onClick={() => toggle('cuisine_preferences', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Alcohol</p>
        <div style={styles.grid}>
          {[['socially', 'Drink socially'], ['regularly', 'Drink regularly'], ['rarely', 'Rarely'], ['non_drinker', 'Non drinker'], ['non_drinker_religious', 'Non drinker — religious']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.alcohol_preference === v} onClick={() => set('alcohol_preference', v)} />
          ))}
        </div>
      </div>

      <div style={styles.btnRow}>
        <button style={styles.backBtn} onClick={onBack}>Back</button>
        <button style={styles.nextBtn} onClick={() => onNext(data)}>Continue</button>
      </div>
    </div>
  );
}

function Step5({ onNext, onBack }: StepProps) {
  const [data, setData] = useState<any>({ water_activities: [], land_activities: [], wellness_interests: [], cultural_interests: [], adrenaline_level: '', nightlife_preference: '' });
  const toggle = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field].includes(val) ? p[field].filter((v: string) => v !== val) : [...p[field], val] }));
  const set = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field] === val ? '' : val }));

  return (
    <div style={styles.step}>
      <h2 style={styles.stepTitle}>Activities & interests</h2>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Water activities</p>
        <div style={styles.grid}>
          {[['scuba_diving', 'Scuba diving'], ['snorkeling', 'Snorkeling'], ['surfing', 'Surfing'], ['sup', 'Stand up paddle'], ['sailing', 'Sailing / boating'], ['fishing', 'Fishing'], ['freediving', 'Freediving'], ['kitesurfing', 'Kitesurfing'], ['swimming', 'Swimming']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.water_activities.includes(v)} onClick={() => toggle('water_activities', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Land activities</p>
        <div style={styles.grid}>
          {[['hiking', 'Hiking / trekking'], ['cycling', 'Cycling'], ['motorbike_touring', 'Motorbike touring'], ['rock_climbing', 'Rock climbing'], ['canyoning', 'Canyoning'], ['paragliding', 'Paragliding'], ['atv', 'ATV / offroad'], ['running', 'Running']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.land_activities.includes(v)} onClick={() => toggle('land_activities', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Wellness & mindfulness</p>
        <div style={styles.grid}>
          {[['yoga', 'Yoga'], ['meditation', 'Meditation'], ['spa_massage', 'Spa & massage'], ['sound_healing', 'Sound healing'], ['detox', 'Detox / cleanse'], ['breathwork', 'Breathwork'], ['ayurveda', 'Ayurveda']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.wellness_interests.includes(v)} onClick={() => toggle('wellness_interests', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Adrenaline level</p>
        <div style={styles.grid}>
          {[['low', 'Low — relaxed experiences'], ['medium', 'Medium — some adventure'], ['high', 'High — push limits'], ['extreme', 'Extreme — more intense the better']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.adrenaline_level === v} onClick={() => set('adrenaline_level', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Nightlife</p>
        <div style={styles.grid}>
          {[['love_it', 'Love it — clubs and bars'], ['occasional', 'Occasional night out'], ['prefer_quiet', 'Prefer quiet evenings'], ['none', 'No nightlife']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.nightlife_preference === v} onClick={() => set('nightlife_preference', v)} />
          ))}
        </div>
      </div>

      <div style={styles.btnRow}>
        <button style={styles.backBtn} onClick={onBack}>Back</button>
        <button style={styles.nextBtn} onClick={() => onNext(data)}>Continue</button>
      </div>
    </div>
  );
}

function Step6({ onNext, onBack }: StepProps) {
  const [data, setData] = useState<any>({ sustainability_commitment: '', fitness_level: '', connectivity_needs: '', lgbtq_considerations: '', values_influence_travel: '', animal_ethics: '' });
  const set = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field] === val ? '' : val }));

  return (
    <div style={styles.step}>
      <h2 style={styles.stepTitle}>Lifestyle & values</h2>
      <p style={styles.stepSub}>These help us match you with the right operators and community</p>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Sustainability commitment</p>
        <div style={styles.grid}>
          {[['very_important', 'Very important — actively seek eco options'], ['important_not_always', 'Important but not always possible'], ['aware_not_priority', 'Aware but not a priority'], ['not_a_factor', 'Not a factor']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.sustainability_commitment === v} onClick={() => set('sustainability_commitment', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Fitness level</p>
        <div style={styles.grid}>
          {[['very_active', 'Very active / athletic'], ['moderately_fit', 'Moderately fit'], ['average', 'Average fitness'], ['limited_mobility', 'Limited mobility']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.fitness_level === v} onClick={() => set('fitness_level', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Connectivity needs</p>
        <div style={styles.grid}>
          {[['need_fast_always', 'Need fast wifi always'], ['need_wifi_slow_ok', 'Need wifi but can be slow'], ['wifi_nice_can_disconnect', 'Wifi nice but can disconnect'], ['prefer_disconnect', 'Prefer to disconnect completely']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.connectivity_needs === v} onClick={() => set('connectivity_needs', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Animal interaction</p>
        <div style={styles.grid}>
          {[['love_encounters', 'Love animal encounters'], ['ethical_only', 'Ethical only — no captive animals'], ['not_interested', 'Not interested']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.animal_ethics === v} onClick={() => set('animal_ethics', v)} />
          ))}
        </div>
      </div>

      <div style={styles.btnRow}>
        <button style={styles.backBtn} onClick={onBack}>Back</button>
        <button style={styles.nextBtn} onClick={() => onNext(data)}>Continue</button>
      </div>
    </div>
  );
}

function Step7({ onNext, onBack }: StepProps) {
  const [data, setData] = useState<any>({ transport_preference: [], has_driving_licence: null, island_hopping_appetite: '', luggage_style: '' });
  const toggle = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field].includes(val) ? p[field].filter((v: string) => v !== val) : [...p[field], val] }));
  const set = (field: string, val: any) => setData((p: any) => ({ ...p, [field]: p[field] === val ? null : val }));

  return (
    <div style={styles.step}>
      <h2 style={styles.stepTitle}>Getting around</h2>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Transport I'm comfortable with</p>
        <div style={styles.grid}>
          {[['ride_motorbike', 'Ride motorbike myself'], ['motorbike_passenger', 'Passenger on motorbike'], ['hire_driver', 'Hire driver / car'], ['public_transport', 'Public transport'], ['walking_cycling_only', 'Walking / cycling only']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.transport_preference.includes(v)} onClick={() => toggle('transport_preference', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Do you have a driving licence?</p>
        <div style={styles.grid}>
          {[[true, 'Yes'], [false, 'No']].map(([v, l]) => (
            <OptionCard key={String(v)} label={l as string} selected={data.has_driving_licence === v} onClick={() => set('has_driving_licence', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Island hopping appetite</p>
        <div style={styles.grid}>
          {[['love_moving', 'Love moving between islands'], ['one_base_day_trips', 'One base, day trips'], ['stay_one_place', 'Stay in one place']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.island_hopping_appetite === v} onClick={() => set('island_hopping_appetite', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Luggage style</p>
        <div style={styles.grid}>
          {[['backpack_only', 'Backpack only'], ['carry_on_only', 'Carry-on only'], ['full_luggage', 'Full luggage — pack everything']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.luggage_style === v} onClick={() => set('luggage_style', v)} />
          ))}
        </div>
      </div>

      <div style={styles.btnRow}>
        <button style={styles.backBtn} onClick={onBack}>Back</button>
        <button style={styles.nextBtn} onClick={() => onNext(data)}>Continue</button>
      </div>
    </div>
  );
}

function Step8({ onNext, onBack }: StepProps) {
  const [data, setData] = useState<any>({ regions_visited: [], bucket_list_regions: [], bali_areas_interest: [], next_trip_timing: '' });
  const toggle = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field].includes(val) ? p[field].filter((v: string) => v !== val) : [...p[field], val] }));
  const set = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field] === val ? '' : val }));

  return (
    <div style={styles.step}>
      <h2 style={styles.stepTitle}>Indonesian islands</h2>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>I've already been to</p>
        <div style={styles.grid}>
          {[['bali_seminyak', 'Bali — Seminyak / Kuta'], ['bali_ubud', 'Bali — Ubud'], ['bali_canggu', 'Bali — Canggu'], ['bali_nusa_penida', 'Bali — Nusa Penida'], ['bali_amed', 'Bali — Amed / East Bali'], ['lombok', 'Lombok'], ['gili_islands', 'Gili Islands'], ['flores_komodo', 'Flores / Komodo'], ['raja_ampat', 'Raja Ampat'], ['sulawesi', 'Sulawesi'], ['java', 'Java'], ['sumatra', 'Sumatra']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.regions_visited.includes(v)} onClick={() => toggle('regions_visited', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>On my bucket list</p>
        <div style={styles.grid}>
          {[['bali', 'Bali'], ['nusa_penida', 'Nusa Penida'], ['lombok', 'Lombok'], ['gili_islands', 'Gili Islands'], ['flores', 'Flores'], ['komodo', 'Komodo'], ['raja_ampat', 'Raja Ampat'], ['sulawesi', 'Sulawesi'], ['java', 'Java'], ['sumatra', 'Sumatra']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.bucket_list_regions.includes(v)} onClick={() => toggle('bucket_list_regions', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Areas of Bali I'm interested in</p>
        <div style={styles.grid}>
          {[['seminyak', 'Seminyak / Legian'], ['canggu', 'Canggu / Pererenan'], ['ubud', 'Ubud'], ['sanur', 'Sanur'], ['nusa_dua', 'Nusa Dua'], ['amed', 'Amed / East Bali'], ['nusa_penida', 'Nusa Penida / Lembongan'], ['uluwatu', 'Uluwatu / Bukit'], ['sidemen', 'Sidemen']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.bali_areas_interest.includes(v)} onClick={() => toggle('bali_areas_interest', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>When's your next trip?</p>
        <div style={styles.grid}>
          {[['planning_now', 'Planning now — within 3 months'], ['next_6_months', 'Next 6 months'], ['within_a_year', 'Within a year'], ['just_dreaming', 'Just dreaming for now'], ['already_here', 'Already here']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.next_trip_timing === v} onClick={() => set('next_trip_timing', v)} />
          ))}
        </div>
      </div>

      <div style={styles.btnRow}>
        <button style={styles.backBtn} onClick={onBack}>Back</button>
        <button style={styles.nextBtn} onClick={() => onNext(data)}>Continue</button>
      </div>
    </div>
  );
}

function Step9({ onNext, onBack }: StepProps) {
  const [data, setData] = useState<any>({ community_participation: [], content_sharing_comfort: '', travel_buddy_preferences: [], referral_source: '' });
  const toggle = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field].includes(val) ? p[field].filter((v: string) => v !== val) : [...p[field], val] }));
  const set = (field: string, val: string) => setData((p: any) => ({ ...p, [field]: p[field] === val ? '' : val }));

  return (
    <div style={styles.step}>
      <h2 style={styles.stepTitle}>Your community style</h2>
      <p style={styles.stepSub}>Last step — how do you want to connect with other members?</p>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>I want to</p>
        <div style={styles.grid}>
          {[['share_reports', 'Share trip reports & tips'], ['ask_questions', 'Ask questions & get advice'], ['meet_members', 'Meet other members'], ['find_travel_buddies', 'Find travel buddies'], ['lurk', 'Just browse for now']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.community_participation.includes(v)} onClick={() => toggle('community_participation', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>Sharing comfort level</p>
        <div style={styles.grid}>
          {[['happy_to_share', 'Happy to share photos & videos'], ['tips_not_photos', 'Share tips but not photos'], ['private', 'Private — prefer not to share']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.content_sharing_comfort === v} onClick={() => set('content_sharing_comfort', v)} />
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <p style={styles.sectionLabel}>How did you hear about us?</p>
        <div style={styles.grid}>
          {[['instagram', 'Instagram'], ['friend_referral', 'Friend referral'], ['google', 'Google search'], ['facebook_group', 'Facebook group'], ['reddit', 'Reddit'], ['other', 'Other']].map(([v, l]) => (
            <OptionCard key={v} label={l} selected={data.referral_source === v} onClick={() => set('referral_source', v)} />
          ))}
        </div>
      </div>

      <div style={styles.btnRow}>
        <button style={styles.backBtn} onClick={onBack}>Back</button>
        <button style={{ ...styles.nextBtn, background: '#1D9E75' }} onClick={() => onNext({ ...data, onboarding_completed: true })}>
          Complete profile
        </button>
      </div>
    </div>
  );
}

const STEP_COMPONENTS = [Step1, Step2, Step3, Step4, Step5, Step6, Step7, Step8, Step9];

export default function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const saveStep = async (data: any, step: number) => {
    setSaving(true);
    setError('');
    try {
      await api.patch('/travelers/me/preferences', {
        ...data,
        onboarding_step: step + 1,
      });
    } catch (err) {
      setError('Could not save. Please try again.');
      setSaving(false);
      return false;
    }
    setSaving(false);
    return true;
  };

  const handleNext = async (data: any) => {
    const ok = await saveStep(data, currentStep);
    if (!ok) return;

    if (currentStep === STEP_COMPONENTS.length - 1) {
      onComplete();
    } else {
      setCurrentStep(s => s + 1);
    }
  };

  const handleBack = () => setCurrentStep(s => Math.max(0, s - 1));

  const StepComponent = STEP_COMPONENTS[currentStep];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <p style={styles.headerLogo}>Travel Tool</p>
        <ProgressBar step={currentStep + 1} total={STEP_COMPONENTS.length} />
        <p style={styles.stepName}>{STEPS[currentStep]}</p>
      </div>
      <div style={styles.body}>
        {error && <div style={styles.error}>{error}</div>}
        {saving && <div style={styles.saving}>Saving...</div>}
        <StepComponent
          onNext={handleNext}
          onBack={handleBack}
          step={currentStep}
          total={STEP_COMPONENTS.length}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#f8f8f6', display: 'flex', flexDirection: 'column' },
  header: { background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '16px 24px' },
  headerLogo: { fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 12 },
  progress: { display: 'flex', alignItems: 'center', gap: 12 },
  progressBar: { flex: 1, height: 4, background: '#f0f0f0', borderRadius: 2 },
  progressFill: { height: 4, background: '#2E7D32', borderRadius: 2, transition: 'width 0.3s ease' },
  progressText: { fontSize: 12, color: '#999', whiteSpace: 'nowrap' },
  stepName: { fontSize: 12, color: '#2E7D32', fontWeight: 500, marginTop: 8 },
  body: { flex: 1, maxWidth: 720, width: '100%', margin: '0 auto', padding: '24px 16px 80px' },
  step: {},
  stepTitle: { fontSize: 26, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 },
  stepSub: { fontSize: 15, color: '#888', marginBottom: 24 },
  section: { marginBottom: 28 },
  sectionLabel: { fontSize: 13, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  grid: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  optionCard: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 16px', borderRadius: 24,
    border: '1.5px solid #e0e0e0', background: '#fff',
    cursor: 'pointer', fontSize: 14, color: '#444',
    transition: 'all 0.15s', fontWeight: 400,
  },
  optionCardSelected: {
    borderColor: '#2E7D32', background: '#f0f7f0', color: '#1a5c1a', fontWeight: 500,
  },
  optionLabel: {},
  optionCheck: { fontSize: 12, color: '#2E7D32' },
  btnRow: { display: 'flex', gap: 12, marginTop: 32 },
  nextBtn: {
    flex: 1, padding: '14px 0', background: '#2E7D32', color: '#fff',
    border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer',
  },
  backBtn: {
    padding: '14px 24px', background: 'transparent', color: '#888',
    border: '1px solid #e0e0e0', borderRadius: 12, fontSize: 15, cursor: 'pointer',
  },
  error: { background: '#ffebee', color: '#c62828', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 },
  saving: { background: '#E8F5E9', color: '#2E7D32', padding: '8px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 },
};
