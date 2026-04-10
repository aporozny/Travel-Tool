-- Traveller Platform Database Schema
-- PostgreSQL

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis"; -- For geospatial queries

-- Users (base table for both travelers and operators)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('traveler', 'operator', 'admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Traveler profiles
CREATE TABLE travelers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(20),
  nationality VARCHAR(50),
  date_of_birth DATE,
  bio TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Traveler preferences
CREATE TABLE traveler_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  traveler_id UUID UNIQUE NOT NULL REFERENCES travelers(id) ON DELETE CASCADE,
  budget_range VARCHAR(20) CHECK (budget_range IN ('budget', 'mid', 'luxury')),
  accommodation_types TEXT[], -- ['hotel', 'villa', 'hostel', 'airbnb']
  activity_types TEXT[],      -- ['diving', 'surfing', 'hiking', 'cultural']
  travel_style TEXT[],        -- ['solo', 'couple', 'group', 'family']
  dietary_requirements TEXT[],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Operators (businesses on the platform)
CREATE TABLE operators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL, -- 'accommodation', 'activity', 'transport', 'food'
  website VARCHAR(255),
  phone VARCHAR(20),
  location GEOGRAPHY(POINT, 4326), -- lat/lng
  address TEXT,
  region VARCHAR(100),             -- e.g. 'Nusa Penida', 'Seminyak'
  country VARCHAR(50) DEFAULT 'Indonesia',
  is_verified BOOLEAN DEFAULT false,
  tier VARCHAR(20) DEFAULT 'free' CHECK (tier IN ('free', 'basic', 'premium')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  traveler_id UUID NOT NULL REFERENCES travelers(id),
  operator_id UUID NOT NULL REFERENCES operators(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  start_date DATE NOT NULL,
  end_date DATE,
  guests INTEGER DEFAULT 1,
  total_amount DECIMAL(10, 2),
  currency VARCHAR(3) DEFAULT 'AUD',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reviews
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID UNIQUE NOT NULL REFERENCES bookings(id),
  traveler_id UUID NOT NULL REFERENCES travelers(id),
  operator_id UUID NOT NULL REFERENCES operators(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title VARCHAR(255),
  body TEXT,
  is_published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safety: traveler emergency contacts
CREATE TABLE safety_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  traveler_id UUID NOT NULL REFERENCES travelers(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  relationship VARCHAR(50),
  can_see_location BOOLEAN DEFAULT true,
  receives_sos BOOLEAN DEFAULT true,
  access_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safety: location history (short retention)
CREATE TABLE location_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  traveler_id UUID NOT NULL REFERENCES travelers(id) ON DELETE CASCADE,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  accuracy DECIMAL(8, 2),
  recorded_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL -- auto-delete after 30 days
);

-- Safety: SOS events
CREATE TABLE sos_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  traveler_id UUID NOT NULL REFERENCES travelers(id),
  location GEOGRAPHY(POINT, 4326),
  message TEXT,
  contacts_notified INTEGER DEFAULT 0,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Consent records (GDPR)
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  consent_type VARCHAR(50) NOT NULL, -- 'location_tracking', 'marketing', 'analytics'
  granted BOOLEAN NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_travelers_user_id ON travelers(user_id);
CREATE INDEX idx_operators_region ON operators(region);
CREATE INDEX idx_operators_category ON operators(category);
CREATE INDEX idx_operators_tier ON operators(tier);
CREATE INDEX idx_operators_location ON operators USING GIST(location);
CREATE INDEX idx_bookings_traveler_id ON bookings(traveler_id);
CREATE INDEX idx_bookings_operator_id ON bookings(operator_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_reviews_operator_id ON reviews(operator_id);
CREATE INDEX idx_location_history_traveler_id ON location_history(traveler_id);
CREATE INDEX idx_location_history_expires_at ON location_history(expires_at);

-- Auto-cleanup expired locations
-- Run via cron or pg_cron: DELETE FROM location_history WHERE expires_at < NOW();
