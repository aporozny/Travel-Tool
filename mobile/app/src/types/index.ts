export interface User {
  id: string;
  email: string;
  role: 'traveler' | 'operator' | 'admin';
}

export interface TravelerProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  nationality: string | null;
  bio: string | null;
  avatar_url: string | null;
  email: string;
  role: string;
}

export interface TravelerPreferences {
  budget_range: 'budget' | 'mid' | 'luxury' | null;
  accommodation_types: string[];
  activity_types: string[];
  travel_style: string[];
  dietary_requirements: string[];
}

export interface Operator {
  id: string;
  business_name: string;
  description: string | null;
  category: 'accommodation' | 'activity' | 'transport' | 'food';
  website: string | null;
  phone: string | null;
  address: string | null;
  region: string | null;
  country: string;
  tier: 'free' | 'basic' | 'premium';
  is_verified: boolean;
  latitude: number | null;
  longitude: number | null;
  avg_rating: string;
  review_count: string;
}

export interface Booking {
  id: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  start_date: string;
  end_date: string | null;
  guests: number;
  total_amount: string | null;
  currency: string;
  notes: string | null;
  created_at: string;
  operator_id?: string;
  business_name?: string;
  category?: string;
  region?: string;
}

export interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  is_published: boolean;
  created_at: string;
  reviewer_name?: string;
  business_name?: string;
  region?: string;
}

export interface SafetyContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  can_see_location: boolean;
  receives_sos: boolean;
  access_expires_at: string | null;
}

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  accuracy?: number;
}
