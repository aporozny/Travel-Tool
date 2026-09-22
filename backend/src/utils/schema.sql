-- GENERATED FILE: this is a schema-only pg_dump of the live database, used by CI to build a
-- fresh test database that structurally matches production. Do not hand-edit it.
--
-- Regenerate after applying a new migration to production:
--   backend/scripts/refresh-ci-schema.sh
--
-- Why a dump instead of migrations/*.sql replayed onto an older schema.sql: this file went
-- stale for months while migrations were applied by hand to production, and migrations 008-020
-- were never saved as files at all, so this repo cannot fully reconstruct history -- only the
-- live database's current, real structure is trustworthy. Verified 2026-09-22: the full test
-- suite (175 tests) passes against a database built from this file alone.
--
--
-- PostgreSQL database dump
--

-- Dumped from database version 15.4 (Debian 15.4-1.pgdg110+1)
-- Dumped by pg_dump version 15.4 (Debian 15.4-1.pgdg110+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: tiger; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger;


--
-- Name: tiger_data; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger_data;


--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA topology;


--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: postgis_tiger_geocoder; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;


--
-- Name: EXTENSION postgis_tiger_geocoder; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_tiger_geocoder IS 'PostGIS tiger geocoder and reverse geocoder';


--
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: create_member_preferences(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_member_preferences() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO member_preferences (traveler_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: update_comment_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_comment_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_reaction_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_reaction_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET reaction_count = reaction_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET reaction_count = GREATEST(0, reaction_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_save_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_save_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.entity_type = 'post' THEN
    UPDATE community_posts SET save_count = save_count + 1 WHERE id = NEW.entity_id;
  ELSIF TG_OP = 'DELETE' AND OLD.entity_type = 'post' THEN
    UPDATE community_posts SET save_count = GREATEST(0, save_count - 1) WHERE id = OLD.entity_id;
  END IF;
  RETURN NULL;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bookable_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookable_offers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    provider text NOT NULL,
    provider_product_id text NOT NULL,
    place_id uuid,
    name text NOT NULL,
    region text NOT NULL,
    country text,
    category text DEFAULT 'activity'::text NOT NULL,
    price_amount numeric(10,2),
    price_currency text,
    checkout_url text NOT NULL,
    match_status text DEFAULT 'no_match'::text NOT NULL,
    matched_operator_id uuid,
    raw_data jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '01:00:00'::interval) NOT NULL,
    CONSTRAINT bookable_offers_match_status_check CHECK ((match_status = ANY (ARRAY['operator_match'::text, 'no_match'::text, 'ambiguous'::text]))),
    CONSTRAINT bookable_offers_provider_check CHECK ((provider = ANY (ARRAY['bokun'::text, 'viator'::text])))
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    traveler_id uuid NOT NULL,
    operator_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    start_date date,
    end_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    guests integer DEFAULT 1 NOT NULL,
    total_amount numeric(10,2),
    currency text DEFAULT 'AUD'::text NOT NULL
);


--
-- Name: community_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_posts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    author_type text DEFAULT 'member'::text NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    place_id uuid,
    place_name text,
    region text,
    country text,
    visibility text DEFAULT 'public'::text NOT NULL,
    reaction_count integer DEFAULT 0 NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lat double precision,
    lng double precision,
    save_count integer DEFAULT 0 NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    operator_id uuid,
    CONSTRAINT community_posts_author_type_check CHECK ((author_type = ANY (ARRAY['member'::text, 'operator'::text, 'system'::text]))),
    CONSTRAINT community_posts_body_check CHECK ((length(body) <= 2000)),
    CONSTRAINT community_posts_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'members'::text, 'connections'::text, 'private'::text])))
);


--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_records (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    granted boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: emergency_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_numbers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country_code character varying(2) NOT NULL,
    country_name character varying(100) NOT NULL,
    service_type character varying(50) NOT NULL,
    number character varying(30) NOT NULL,
    description text,
    hours character varying(100),
    language character varying(50),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: flight_offers_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flight_offers_cache (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    search_key text NOT NULL,
    duffel_offer_id text NOT NULL,
    duffel_offer_request_id text NOT NULL,
    slices jsonb NOT NULL,
    passenger_types jsonb NOT NULL,
    cabin_class text,
    base_amount numeric(10,2) NOT NULL,
    base_currency text NOT NULL,
    tax_amount numeric(10,2) NOT NULL,
    total_amount numeric(10,2) NOT NULL,
    total_currency text NOT NULL,
    fare_conditions jsonb,
    owner_airline_iata text,
    expires_at timestamp with time zone NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: flight_order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flight_order_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    flight_order_id uuid NOT NULL,
    duffel_event_id text,
    event_type text NOT NULL,
    old_slices jsonb,
    new_slices jsonb,
    refund_amount numeric(10,2),
    refund_currency text,
    status text DEFAULT 'pending'::text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT flight_order_events_event_type_check CHECK ((event_type = ANY (ARRAY['schedule_change'::text, 'cancellation'::text, 'refund_requested'::text, 'refund_completed'::text]))),
    CONSTRAINT flight_order_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'traveler_notified'::text, 'resolved'::text])))
);


--
-- Name: flight_order_passengers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flight_order_passengers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    flight_order_id uuid NOT NULL,
    traveler_id uuid,
    duffel_passenger_id text NOT NULL,
    title text,
    given_name text NOT NULL,
    family_name text NOT NULL,
    date_of_birth date NOT NULL,
    gender text,
    passport_number_enc bytea,
    passport_country text,
    passport_expiry date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: flight_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flight_orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    duffel_order_id text NOT NULL,
    source_offer_id text NOT NULL,
    booking_reference text NOT NULL,
    status text DEFAULT 'pending_payment'::text NOT NULL,
    slices jsonb NOT NULL,
    duffel_cost_amount numeric(10,2) NOT NULL,
    duffel_cost_currency text NOT NULL,
    price_charged_amount numeric(10,2) NOT NULL,
    price_charged_currency text NOT NULL,
    markup_amount numeric(10,2) NOT NULL,
    markup_rule_id uuid,
    ticketed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_intent_id text,
    CONSTRAINT flight_orders_status_check CHECK ((status = ANY (ARRAY['pending_payment'::text, 'confirmed'::text, 'ticketed'::text, 'cancelled'::text, 'refunded'::text])))
);


--
-- Name: flight_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flight_payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    duffel_payment_intent_id text NOT NULL,
    user_id uuid NOT NULL,
    duffel_offer_id text NOT NULL,
    summary text,
    amount numeric(10,2) NOT NULL,
    currency text NOT NULL,
    status text DEFAULT 'created'::text NOT NULL,
    passengers jsonb,
    flight_order_id uuid,
    duffel_order_id text,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    error_code text,
    retryable boolean,
    is_test boolean DEFAULT false NOT NULL,
    alerted_at timestamp with time zone,
    reconciled_at timestamp with time zone,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT flight_payments_status_check CHECK ((status = ANY (ARRAY['created'::text, 'paid'::text, 'ordering'::text, 'ordered'::text, 'order_failed'::text, 'refund_requested'::text, 'refunded'::text])))
);


--
-- Name: identity_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_verifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    traveler_id uuid NOT NULL,
    provider text DEFAULT 'stripe_identity'::text NOT NULL,
    provider_session_id text,
    provider_report_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    id_type text,
    id_country character(2),
    face_match_score numeric(5,4),
    liveness_score numeric(5,4),
    failure_reason text,
    failure_detail text,
    risk_signals jsonb DEFAULT '[]'::jsonb,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    expires_at timestamp with time zone,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: in_app_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.in_app_notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    segment_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    link text,
    dedupe_key text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: listing_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_claims (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    place_id uuid,
    user_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    operator_id uuid,
    evidence text,
    contact_email text,
    contact_phone text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    CONSTRAINT listing_claims_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: location_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    accuracy_m real,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL
);


--
-- Name: markup_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.markup_rules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    route_origin text,
    route_destination text,
    markup_type text NOT NULL,
    markup_value numeric(10,4) NOT NULL,
    min_fee numeric(10,2),
    max_fee numeric(10,2),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT markup_rules_markup_type_check CHECK ((markup_type = ANY (ARRAY['percentage'::text, 'fixed'::text]))),
    CONSTRAINT markup_rules_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'route'::text, 'cabin_class'::text])))
);


--
-- Name: member_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_connections (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    requester_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_connections_check CHECK ((requester_id <> recipient_id)),
    CONSTRAINT member_connections_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'blocked'::text])))
);


--
-- Name: member_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_interactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    interaction_type text NOT NULL,
    region text,
    category text,
    tags text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    connection_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    body text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_preferences (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    traveler_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    travel_style text[] DEFAULT '{}'::text[],
    trip_length_preference text,
    travel_frequency text,
    sea_experience_level text,
    work_situation text,
    travel_pace text,
    social_preference text,
    languages_spoken text[] DEFAULT '{}'::text[],
    budget_range text,
    accommodation_budget_aud text,
    splurge_categories text[] DEFAULT '{}'::text[],
    payment_preference text,
    eco_spend_willingness text,
    accommodation_types text[] DEFAULT '{}'::text[],
    accommodation_must_haves text[] DEFAULT '{}'::text[],
    accommodation_deal_breakers text[] DEFAULT '{}'::text[],
    location_preference text[] DEFAULT '{}'::text[],
    stay_length_preference text,
    dietary_requirements text[] DEFAULT '{}'::text[],
    food_adventurousness text,
    spice_tolerance text,
    cuisine_preferences text[] DEFAULT '{}'::text[],
    dining_style text,
    coffee_preference text,
    alcohol_preference text,
    meal_timing text,
    food_experiences text[] DEFAULT '{}'::text[],
    water_activities text[] DEFAULT '{}'::text[],
    land_activities text[] DEFAULT '{}'::text[],
    wellness_interests text[] DEFAULT '{}'::text[],
    cultural_interests text[] DEFAULT '{}'::text[],
    nightlife_preference text,
    adrenaline_level text,
    nature_interests text[] DEFAULT '{}'::text[],
    creative_interests text[] DEFAULT '{}'::text[],
    animal_ethics text,
    volunteering_interest text,
    sustainability_commitment text,
    carbon_offset_attitude text,
    shopping_preference text,
    fitness_level text,
    connectivity_needs text,
    spiritual_practice text,
    values_influence_travel text,
    lgbtq_considerations text,
    transport_preference text[] DEFAULT '{}'::text[],
    has_driving_licence boolean,
    island_hopping_appetite text,
    domestic_flight_comfort text,
    luggage_style text,
    regions_visited text[] DEFAULT '{}'::text[],
    bucket_list_regions text[] DEFAULT '{}'::text[],
    bali_areas_interest text[] DEFAULT '{}'::text[],
    next_trip_timing text,
    community_participation text[] DEFAULT '{}'::text[],
    content_sharing_comfort text,
    travel_buddy_preferences text[] DEFAULT '{}'::text[],
    notification_preferences text[] DEFAULT '{}'::text[],
    referral_source text,
    onboarding_completed boolean DEFAULT false,
    onboarding_step integer DEFAULT 0,
    onboarding_completed_at timestamp with time zone
);


--
-- Name: member_saves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_saves (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_trips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_trips (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    destination text NOT NULL,
    region text,
    country text DEFAULT 'Indonesia'::text,
    start_date date,
    end_date date,
    travel_style text[] DEFAULT '{}'::text[],
    looking_for text[] DEFAULT '{}'::text[],
    notes text,
    is_public boolean DEFAULT true,
    checkin_interval_hours smallint DEFAULT 24 NOT NULL,
    next_checkin_due timestamp with time zone,
    last_checkin_at timestamp with time zone,
    safety_status text DEFAULT 'planned'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    overdue_since timestamp with time zone,
    overdue_alerted_at timestamp with time zone,
    escalation_flagged_at timestamp with time zone,
    escalated_at timestamp with time zone,
    CONSTRAINT member_trips_checkin_interval_hours_check CHECK (((checkin_interval_hours >= 1) AND (checkin_interval_hours <= 168))),
    CONSTRAINT member_trips_notes_check CHECK ((length(notes) <= 500)),
    CONSTRAINT member_trips_safety_status_check CHECK ((safety_status = ANY (ARRAY['planned'::text, 'active'::text, 'overdue'::text, 'completed'::text, 'escalated'::text])))
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    email_enabled boolean DEFAULT true NOT NULL,
    in_app_enabled boolean DEFAULT true NOT NULL,
    sms_enabled boolean DEFAULT false NOT NULL,
    offers_enabled boolean DEFAULT false NOT NULL,
    quiet_start text DEFAULT '22:00'::text NOT NULL,
    quiet_end text DEFAULT '07:00'::text NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: operator_trust_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_trust_scores (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    operator_id uuid NOT NULL,
    score_identity smallint DEFAULT 0 NOT NULL,
    score_reviews smallint DEFAULT 0 NOT NULL,
    score_responsiveness smallint DEFAULT 0 NOT NULL,
    score_completion smallint DEFAULT 0 NOT NULL,
    score_safety_record smallint DEFAULT 100 NOT NULL,
    score_tenure smallint DEFAULT 0 NOT NULL,
    composite_score smallint DEFAULT 0 NOT NULL,
    trust_tier text DEFAULT 'new'::text NOT NULL,
    total_bookings integer DEFAULT 0 NOT NULL,
    completed_bookings integer DEFAULT 0 NOT NULL,
    safety_reports_against integer DEFAULT 0 NOT NULL,
    last_calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: operators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operators (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    business_name text NOT NULL,
    description text,
    category text NOT NULL,
    website text,
    phone text,
    location public.geography(Point,4326),
    address text,
    region text,
    country text DEFAULT 'Indonesia'::text,
    is_verified boolean DEFAULT false NOT NULL,
    tier text DEFAULT 'free'::text NOT NULL,
    tags text[] DEFAULT '{}'::text[],
    price_level integer,
    images text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: places_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.places_cache (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    external_id text NOT NULL,
    source text NOT NULL,
    name text NOT NULL,
    category text,
    description text,
    address text,
    region text,
    country text DEFAULT 'Indonesia'::text,
    latitude numeric(10,7),
    longitude numeric(10,7),
    phone text,
    website text,
    rating numeric(3,1),
    review_count integer DEFAULT 0,
    price_level integer,
    photos jsonb DEFAULT '[]'::jsonb,
    opening_hours jsonb,
    tags text[],
    raw_data jsonb,
    is_claimed boolean DEFAULT false,
    claimed_by uuid,
    operator_id uuid,
    expires_at timestamp with time zone DEFAULT (now() + '365 days'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_subregion_tag text,
    sub_area_id uuid,
    submitted_by uuid
);


--
-- Name: post_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_comments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    CONSTRAINT post_comments_body_check CHECK (((length(body) >= 1) AND (length(body) <= 1000)))
);


--
-- Name: post_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_media (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    post_id uuid NOT NULL,
    url text NOT NULL,
    type text DEFAULT 'image'::text NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: post_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_reactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    reaction text DEFAULT 'like'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT post_reactions_reaction_check CHECK ((reaction = ANY (ARRAY['like'::text, 'fire'::text, 'heart'::text, 'wave'::text])))
);


--
-- Name: provider_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_bookings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    offer_id uuid,
    provider text NOT NULL,
    provider_booking_reference text NOT NULL,
    user_id uuid,
    amount numeric(10,2) NOT NULL,
    currency text NOT NULL,
    commission_amount numeric(10,2),
    status text DEFAULT 'pending'::text NOT NULL,
    webhook_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provider_bookings_provider_check CHECK ((provider = ANY (ARRAY['bokun'::text, 'viator'::text]))),
    CONSTRAINT provider_bookings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text, 'refunded'::text])))
);


--
-- Name: recommendation_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_cache (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cache_key text NOT NULL,
    results jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_audit_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    report_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    from_status text,
    to_status text,
    action text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    operator_id uuid NOT NULL,
    traveler_id uuid NOT NULL,
    booking_id uuid,
    rating integer NOT NULL,
    body text,
    is_published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    title character varying(255),
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: safety_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_contacts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    relationship text,
    can_see_location boolean DEFAULT true NOT NULL,
    receives_sos boolean DEFAULT true NOT NULL,
    trip_id uuid,
    notify_on_overdue boolean DEFAULT true NOT NULL,
    notify_on_sos boolean DEFAULT true NOT NULL,
    notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: safety_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safety_reports (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reporter_id uuid NOT NULL,
    reported_traveler_id uuid,
    reported_operator_id uuid,
    category text NOT NULL,
    description text NOT NULL,
    evidence_urls text[] DEFAULT '{}'::text[],
    trip_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    severity smallint DEFAULT 2 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reported_place_cache_id uuid
);


--
-- Name: scheduled_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    segment_id uuid,
    type text NOT NULL,
    channel text NOT NULL,
    send_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    dedupe_key text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    locked_at timestamp with time zone,
    last_error text,
    skip_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT scheduled_notifications_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'in_app'::text]))),
    CONSTRAINT scheduled_notifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'skipped'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: search_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_queries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    query text NOT NULL,
    region text,
    category text,
    results integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sos_ai_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_ai_calls (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sos_event_id uuid NOT NULL,
    caller_phone text NOT NULL,
    user_id uuid,
    platform text DEFAULT 'retell'::text NOT NULL,
    platform_call_id text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    transcript text,
    ai_outcome text,
    emergency_number_given text,
    country_code_used text,
    human_notified_at timestamp with time zone,
    contact_bridge_attempted boolean DEFAULT false NOT NULL,
    contact_bridge_connected boolean DEFAULT false NOT NULL,
    raw_webhook_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sos_ai_calls_ai_outcome_check CHECK ((ai_outcome = ANY (ARRAY['genuine_emergency'::text, 'distressed_relayed'::text, 'false_alarm'::text, 'unclear_escalated'::text])))
);


--
-- Name: sos_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    trigger_type text DEFAULT 'button'::text NOT NULL,
    last_known_lat double precision,
    last_known_lng double precision,
    last_location_at timestamp with time zone,
    member_message text,
    resolution_note text,
    resolved_by uuid,
    contacts_notified integer DEFAULT 0 NOT NULL,
    services_notified boolean DEFAULT false NOT NULL,
    false_alarm_at timestamp with time zone,
    escalated_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sos_location_pings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_location_pings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sos_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    accuracy_m real,
    battery_pct smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sos_responders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_responders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sos_id uuid NOT NULL,
    safety_contact_id uuid,
    name text NOT NULL,
    phone text,
    email text,
    notified_at timestamp with time zone DEFAULT now() NOT NULL,
    notification_method text DEFAULT 'sms'::text NOT NULL,
    acknowledged_at timestamp with time zone,
    response_note text
);


--
-- Name: sub_area_coverage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_area_coverage (
    sub_area_id uuid NOT NULL,
    category text NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    meets_threshold boolean DEFAULT false NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sub_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_areas (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    region text NOT NULL,
    canonical_name text NOT NULL,
    canonical_slug text NOT NULL,
    source text NOT NULL,
    centroid_lat numeric(10,7),
    centroid_lng numeric(10,7),
    geometry public.geometry(MultiPolygon,4326),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sub_areas_source_check CHECK ((source = ANY (ARRAY['google_tag'::text, 'cluster'::text, 'osm_boundary'::text])))
);


--
-- Name: travel_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.travel_requirements (
    rule_key text NOT NULL,
    country_code text NOT NULL,
    airport_iata text,
    remind_at text[] DEFAULT ARRAY['pre_7d'::text] NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    source_url text NOT NULL,
    verified_at date,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: traveler_bans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.traveler_bans (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    traveler_id uuid NOT NULL,
    ban_type text NOT NULL,
    reason text NOT NULL,
    report_id uuid,
    banned_by uuid NOT NULL,
    banned_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    lifted_at timestamp with time zone,
    lifted_by uuid,
    lift_reason text
);


--
-- Name: travelers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.travelers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    first_name text,
    last_name text,
    display_name text,
    bio text,
    avatar_url text,
    phone text,
    home_city text,
    home_country text,
    show_in_directory boolean DEFAULT true NOT NULL,
    identity_verified boolean DEFAULT false NOT NULL,
    identity_verified_at timestamp with time zone,
    trust_level smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    nationality character varying(50),
    date_of_birth date,
    CONSTRAINT travelers_trust_level_check CHECK (((trust_level >= 0) AND (trust_level <= 5)))
);


--
-- Name: trip_checkins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trip_checkins (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    trip_id uuid NOT NULL,
    traveler_id uuid NOT NULL,
    lat double precision,
    lng double precision,
    accuracy_m real,
    battery_pct smallint,
    note text,
    device_id text,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trip_rsvps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trip_rsvps (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    trip_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'confirmed'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trip_rsvps_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'waitlisted'::text, 'cancelled'::text])))
);


--
-- Name: trip_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trip_segments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    source text NOT NULL,
    order_id text NOT NULL,
    leg_index integer DEFAULT 0 NOT NULL,
    kind text NOT NULL,
    carrier text,
    flight_numbers text[],
    origin_iata text,
    dest_iata text,
    origin_city text,
    dest_city text,
    dest_country text,
    dep_local text NOT NULL,
    arr_local text,
    dep_tz text,
    arr_tz text,
    dep_utc timestamp with time zone,
    arr_utc timestamp with time zone,
    place_name text,
    address text,
    reference text,
    supplier_reference text,
    order_status text,
    status text DEFAULT 'active'::text NOT NULL,
    is_test boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trip_segments_kind_check CHECK ((kind = ANY (ARRAY['flight'::text, 'hotel'::text]))),
    CONSTRAINT trip_segments_source_check CHECK ((source = ANY (ARRAY['tripgic'::text, 'duffel'::text]))),
    CONSTRAINT trip_segments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))
);


--
-- Name: tripgic_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tripgic_orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    product_type text NOT NULL,
    quote_id text NOT NULL,
    tripgic_tracking_id text NOT NULL,
    tripgic_booking_id text,
    supplier_reference text,
    status text DEFAULT 'held'::text NOT NULL,
    title text NOT NULL,
    details jsonb NOT NULL,
    cost_amount numeric(10,2) NOT NULL,
    cost_currency text NOT NULL,
    price_charged_amount numeric(10,2) NOT NULL,
    price_charged_currency text NOT NULL,
    markup_amount numeric(10,2) NOT NULL,
    markup_rule_id uuid,
    payment_status text NOT NULL,
    fulfilment_error text,
    voucher_url text,
    hold_expires_at timestamp with time zone,
    fulfilled_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_synced_at timestamp with time zone,
    supplier_status text,
    owner_alerted_at timestamp with time zone,
    CONSTRAINT tripgic_orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['not_collected_sandbox'::text, 'collected'::text]))),
    CONSTRAINT tripgic_orders_product_type_check CHECK ((product_type = ANY (ARRAY['flight'::text, 'hotel'::text]))),
    CONSTRAINT tripgic_orders_status_check CHECK ((status = ANY (ARRAY['held'::text, 'ticketed'::text, 'confirmed'::text, 'cancelled'::text, 'expired'::text, 'failed'::text])))
);


--
-- Name: trips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trips (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    created_by uuid NOT NULL,
    title text NOT NULL,
    description text,
    destination text,
    region text,
    country text,
    start_date date,
    end_date date,
    capacity integer,
    cover_image_url text,
    status text DEFAULT 'published'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trips_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'cancelled'::text])))
);


--
-- Name: user_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_blocks_check CHECK ((blocker_id <> blocked_id))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'traveler'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    invite_token_used text,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['traveler'::text, 'operator'::text, 'admin'::text])))
);


--
-- Name: waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text,
    source text DEFAULT 'direct'::text,
    note text,
    status text DEFAULT 'waiting'::text NOT NULL,
    invite_token text,
    invite_expires_at timestamp with time zone,
    invite_used_at timestamp with time zone,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    destination text,
    CONSTRAINT waitlist_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'approved'::text, 'invited'::text, 'joined'::text])))
);


--
-- Name: bookable_offers bookable_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookable_offers
    ADD CONSTRAINT bookable_offers_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: community_posts community_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_pkey PRIMARY KEY (id);


--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);


--
-- Name: emergency_numbers emergency_numbers_country_code_service_type_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_numbers
    ADD CONSTRAINT emergency_numbers_country_code_service_type_number_key UNIQUE (country_code, service_type, number);


--
-- Name: emergency_numbers emergency_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_numbers
    ADD CONSTRAINT emergency_numbers_pkey PRIMARY KEY (id);


--
-- Name: flight_offers_cache flight_offers_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_offers_cache
    ADD CONSTRAINT flight_offers_cache_pkey PRIMARY KEY (id);


--
-- Name: flight_order_events flight_order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_order_events
    ADD CONSTRAINT flight_order_events_pkey PRIMARY KEY (id);


--
-- Name: flight_order_passengers flight_order_passengers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_order_passengers
    ADD CONSTRAINT flight_order_passengers_pkey PRIMARY KEY (id);


--
-- Name: flight_orders flight_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_orders
    ADD CONSTRAINT flight_orders_pkey PRIMARY KEY (id);


--
-- Name: flight_payments flight_payments_duffel_payment_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_payments
    ADD CONSTRAINT flight_payments_duffel_payment_intent_id_key UNIQUE (duffel_payment_intent_id);


--
-- Name: flight_payments flight_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_payments
    ADD CONSTRAINT flight_payments_pkey PRIMARY KEY (id);


--
-- Name: identity_verifications identity_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_verifications
    ADD CONSTRAINT identity_verifications_pkey PRIMARY KEY (id);


--
-- Name: in_app_notifications in_app_notifications_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.in_app_notifications
    ADD CONSTRAINT in_app_notifications_dedupe_key_key UNIQUE (dedupe_key);


--
-- Name: in_app_notifications in_app_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.in_app_notifications
    ADD CONSTRAINT in_app_notifications_pkey PRIMARY KEY (id);


--
-- Name: listing_claims listing_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_claims
    ADD CONSTRAINT listing_claims_pkey PRIMARY KEY (id);


--
-- Name: location_history location_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_history
    ADD CONSTRAINT location_history_pkey PRIMARY KEY (id);


--
-- Name: markup_rules markup_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.markup_rules
    ADD CONSTRAINT markup_rules_pkey PRIMARY KEY (id);


--
-- Name: member_connections member_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_connections
    ADD CONSTRAINT member_connections_pkey PRIMARY KEY (id);


--
-- Name: member_connections member_connections_requester_id_recipient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_connections
    ADD CONSTRAINT member_connections_requester_id_recipient_id_key UNIQUE (requester_id, recipient_id);


--
-- Name: member_interactions member_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_interactions
    ADD CONSTRAINT member_interactions_pkey PRIMARY KEY (id);


--
-- Name: member_messages member_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_messages
    ADD CONSTRAINT member_messages_pkey PRIMARY KEY (id);


--
-- Name: member_preferences member_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_preferences
    ADD CONSTRAINT member_preferences_pkey PRIMARY KEY (id);


--
-- Name: member_preferences member_preferences_traveler_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_preferences
    ADD CONSTRAINT member_preferences_traveler_id_key UNIQUE (traveler_id);


--
-- Name: member_saves member_saves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_saves
    ADD CONSTRAINT member_saves_pkey PRIMARY KEY (id);


--
-- Name: member_saves member_saves_user_id_entity_type_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_saves
    ADD CONSTRAINT member_saves_user_id_entity_type_entity_id_key UNIQUE (user_id, entity_type, entity_id);


--
-- Name: member_trips member_trips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_trips
    ADD CONSTRAINT member_trips_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: operator_trust_scores operator_trust_scores_operator_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_trust_scores
    ADD CONSTRAINT operator_trust_scores_operator_id_key UNIQUE (operator_id);


--
-- Name: operator_trust_scores operator_trust_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_trust_scores
    ADD CONSTRAINT operator_trust_scores_pkey PRIMARY KEY (id);


--
-- Name: operators operators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_pkey PRIMARY KEY (id);


--
-- Name: operators operators_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_user_id_key UNIQUE (user_id);


--
-- Name: places_cache places_cache_external_id_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.places_cache
    ADD CONSTRAINT places_cache_external_id_source_key UNIQUE (external_id, source);


--
-- Name: places_cache places_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.places_cache
    ADD CONSTRAINT places_cache_pkey PRIMARY KEY (id);


--
-- Name: post_comments post_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_pkey PRIMARY KEY (id);


--
-- Name: post_media post_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_media
    ADD CONSTRAINT post_media_pkey PRIMARY KEY (id);


--
-- Name: post_reactions post_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_reactions
    ADD CONSTRAINT post_reactions_pkey PRIMARY KEY (id);


--
-- Name: post_reactions post_reactions_post_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_reactions
    ADD CONSTRAINT post_reactions_post_id_user_id_key UNIQUE (post_id, user_id);


--
-- Name: provider_bookings provider_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_bookings
    ADD CONSTRAINT provider_bookings_pkey PRIMARY KEY (id);


--
-- Name: recommendation_cache recommendation_cache_cache_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_cache
    ADD CONSTRAINT recommendation_cache_cache_key_key UNIQUE (cache_key);


--
-- Name: recommendation_cache recommendation_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_cache
    ADD CONSTRAINT recommendation_cache_pkey PRIMARY KEY (id);


--
-- Name: report_audit_log report_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_audit_log
    ADD CONSTRAINT report_audit_log_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: safety_contacts safety_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_contacts
    ADD CONSTRAINT safety_contacts_pkey PRIMARY KEY (id);


--
-- Name: safety_reports safety_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_reports
    ADD CONSTRAINT safety_reports_pkey PRIMARY KEY (id);


--
-- Name: scheduled_notifications scheduled_notifications_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_notifications
    ADD CONSTRAINT scheduled_notifications_dedupe_key_key UNIQUE (dedupe_key);


--
-- Name: scheduled_notifications scheduled_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_notifications
    ADD CONSTRAINT scheduled_notifications_pkey PRIMARY KEY (id);


--
-- Name: search_queries search_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_queries
    ADD CONSTRAINT search_queries_pkey PRIMARY KEY (id);


--
-- Name: sos_ai_calls sos_ai_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_ai_calls
    ADD CONSTRAINT sos_ai_calls_pkey PRIMARY KEY (id);


--
-- Name: sos_events sos_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_events
    ADD CONSTRAINT sos_events_pkey PRIMARY KEY (id);


--
-- Name: sos_location_pings sos_location_pings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_location_pings
    ADD CONSTRAINT sos_location_pings_pkey PRIMARY KEY (id);


--
-- Name: sos_responders sos_responders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_responders
    ADD CONSTRAINT sos_responders_pkey PRIMARY KEY (id);


--
-- Name: sub_area_coverage sub_area_coverage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_area_coverage
    ADD CONSTRAINT sub_area_coverage_pkey PRIMARY KEY (sub_area_id, category);


--
-- Name: sub_areas sub_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_areas
    ADD CONSTRAINT sub_areas_pkey PRIMARY KEY (id);


--
-- Name: travel_requirements travel_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travel_requirements
    ADD CONSTRAINT travel_requirements_pkey PRIMARY KEY (rule_key);


--
-- Name: traveler_bans traveler_bans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traveler_bans
    ADD CONSTRAINT traveler_bans_pkey PRIMARY KEY (id);


--
-- Name: travelers travelers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travelers
    ADD CONSTRAINT travelers_pkey PRIMARY KEY (id);


--
-- Name: travelers travelers_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travelers
    ADD CONSTRAINT travelers_user_id_key UNIQUE (user_id);


--
-- Name: trip_checkins trip_checkins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_checkins
    ADD CONSTRAINT trip_checkins_pkey PRIMARY KEY (id);


--
-- Name: trip_rsvps trip_rsvps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_rsvps
    ADD CONSTRAINT trip_rsvps_pkey PRIMARY KEY (id);


--
-- Name: trip_rsvps trip_rsvps_trip_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_rsvps
    ADD CONSTRAINT trip_rsvps_trip_id_user_id_key UNIQUE (trip_id, user_id);


--
-- Name: trip_segments trip_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_segments
    ADD CONSTRAINT trip_segments_pkey PRIMARY KEY (id);


--
-- Name: trip_segments trip_segments_source_order_id_leg_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_segments
    ADD CONSTRAINT trip_segments_source_order_id_leg_index_key UNIQUE (source, order_id, leg_index);


--
-- Name: tripgic_orders tripgic_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tripgic_orders
    ADD CONSTRAINT tripgic_orders_pkey PRIMARY KEY (id);


--
-- Name: trips trips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (id);


--
-- Name: user_blocks user_blocks_blocker_id_blocked_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_blocked_id_key UNIQUE (blocker_id, blocked_id);


--
-- Name: user_blocks user_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: waitlist waitlist_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_email_key UNIQUE (email);


--
-- Name: waitlist waitlist_invite_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_invite_token_key UNIQUE (invite_token);


--
-- Name: waitlist waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);


--
-- Name: idx_bookable_offers_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookable_offers_expires ON public.bookable_offers USING btree (expires_at);


--
-- Name: idx_bookable_offers_place; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookable_offers_place ON public.bookable_offers USING btree (place_id);


--
-- Name: idx_bookable_offers_provider_product; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bookable_offers_provider_product ON public.bookable_offers USING btree (provider, provider_product_id);


--
-- Name: idx_bookable_offers_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookable_offers_region ON public.bookable_offers USING btree (region, category);


--
-- Name: idx_bookings_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_created_at ON public.bookings USING btree (created_at);


--
-- Name: idx_bookings_operator_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_operator_status ON public.bookings USING btree (operator_id, status);


--
-- Name: idx_bookings_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_start_date ON public.bookings USING btree (start_date);


--
-- Name: idx_bookings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);


--
-- Name: idx_bookings_traveler_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_traveler_status ON public.bookings USING btree (traveler_id, status);


--
-- Name: idx_checkins_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkins_trip ON public.trip_checkins USING btree (trip_id);


--
-- Name: idx_comments_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_post ON public.post_comments USING btree (post_id);


--
-- Name: idx_comments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_user ON public.post_comments USING btree (user_id);


--
-- Name: idx_connections_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connections_recipient ON public.member_connections USING btree (recipient_id);


--
-- Name: idx_connections_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connections_requester ON public.member_connections USING btree (requester_id);


--
-- Name: idx_connections_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connections_status ON public.member_connections USING btree (status);


--
-- Name: idx_consent_records_user_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_records_user_type_created ON public.consent_records USING btree (user_id, type, created_at DESC);


--
-- Name: idx_emergency_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emergency_country ON public.emergency_numbers USING btree (country_code);


--
-- Name: idx_emergency_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emergency_type ON public.emergency_numbers USING btree (service_type);


--
-- Name: idx_flight_offers_cache_duffel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_flight_offers_cache_duffel_id ON public.flight_offers_cache USING btree (duffel_offer_id);


--
-- Name: idx_flight_offers_cache_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_offers_cache_expires ON public.flight_offers_cache USING btree (expires_at);


--
-- Name: idx_flight_offers_cache_search_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_offers_cache_search_key ON public.flight_offers_cache USING btree (search_key);


--
-- Name: idx_flight_order_events_duffel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_flight_order_events_duffel_id ON public.flight_order_events USING btree (duffel_event_id) WHERE (duffel_event_id IS NOT NULL);


--
-- Name: idx_flight_order_events_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_order_events_order ON public.flight_order_events USING btree (flight_order_id);


--
-- Name: idx_flight_order_passengers_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_order_passengers_order ON public.flight_order_passengers USING btree (flight_order_id);


--
-- Name: idx_flight_orders_duffel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_flight_orders_duffel_id ON public.flight_orders USING btree (duffel_order_id);


--
-- Name: idx_flight_orders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_orders_user ON public.flight_orders USING btree (user_id);


--
-- Name: idx_flight_payments_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_payments_open ON public.flight_payments USING btree (updated_at) WHERE (status = ANY (ARRAY['created'::text, 'paid'::text, 'ordering'::text, 'order_failed'::text]));


--
-- Name: idx_flight_payments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_payments_user ON public.flight_payments USING btree (user_id, created_at DESC);


--
-- Name: idx_in_app_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_in_app_notifications_user ON public.in_app_notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_interactions_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_entity ON public.member_interactions USING btree (entity_type, entity_id);


--
-- Name: idx_interactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_type ON public.member_interactions USING btree (interaction_type);


--
-- Name: idx_interactions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_user ON public.member_interactions USING btree (user_id);


--
-- Name: idx_iv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iv_status ON public.identity_verifications USING btree (status);


--
-- Name: idx_iv_traveler_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iv_traveler_id ON public.identity_verifications USING btree (traveler_id);


--
-- Name: idx_listing_claims_operator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listing_claims_operator ON public.listing_claims USING btree (operator_id);


--
-- Name: idx_listing_claims_place; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listing_claims_place ON public.listing_claims USING btree (place_id);


--
-- Name: idx_location_history_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_history_expires_at ON public.location_history USING btree (expires_at);


--
-- Name: idx_location_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_history_user_id ON public.location_history USING btree (user_id);


--
-- Name: idx_member_prefs_budget; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_prefs_budget ON public.member_preferences USING btree (budget_range);


--
-- Name: idx_member_prefs_onboarding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_prefs_onboarding ON public.member_preferences USING btree (onboarding_completed);


--
-- Name: idx_member_prefs_traveler; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_prefs_traveler ON public.member_preferences USING btree (traveler_id);


--
-- Name: idx_member_trips_checkin_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_trips_checkin_due ON public.member_trips USING btree (next_checkin_due) WHERE (safety_status = ANY (ARRAY['active'::text, 'overdue'::text]));


--
-- Name: idx_messages_connection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_connection ON public.member_messages USING btree (connection_id);


--
-- Name: idx_messages_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_read ON public.member_messages USING btree (is_read);


--
-- Name: idx_messages_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_recipient ON public.member_messages USING btree (recipient_id);


--
-- Name: idx_messages_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_sender ON public.member_messages USING btree (sender_id);


--
-- Name: idx_operators_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operators_category ON public.operators USING btree (category);


--
-- Name: idx_operators_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operators_region ON public.operators USING btree (region);


--
-- Name: idx_operators_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operators_tags ON public.operators USING gin (tags);


--
-- Name: idx_places_cache_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_places_cache_category ON public.places_cache USING btree (category);


--
-- Name: idx_places_cache_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_places_cache_expires ON public.places_cache USING btree (expires_at);


--
-- Name: idx_places_cache_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_places_cache_external_id ON public.places_cache USING btree (external_id);


--
-- Name: idx_places_cache_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_places_cache_region ON public.places_cache USING btree (region);


--
-- Name: idx_places_cache_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_places_cache_source ON public.places_cache USING btree (source);


--
-- Name: idx_places_cache_sub_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_places_cache_sub_area ON public.places_cache USING btree (sub_area_id);


--
-- Name: idx_places_cache_unresolved_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_places_cache_unresolved_tag ON public.places_cache USING btree (region) WHERE ((raw_subregion_tag IS NOT NULL) AND (sub_area_id IS NULL));


--
-- Name: idx_post_media_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_media_post ON public.post_media USING btree (post_id);


--
-- Name: idx_posts_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_author ON public.community_posts USING btree (author_id);


--
-- Name: idx_posts_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_created ON public.community_posts USING btree (created_at DESC);


--
-- Name: idx_posts_pinned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_pinned ON public.community_posts USING btree (is_pinned) WHERE (is_pinned = true);


--
-- Name: idx_posts_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_region ON public.community_posts USING btree (region);


--
-- Name: idx_posts_visibility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_visibility ON public.community_posts USING btree (visibility);


--
-- Name: idx_provider_bookings_provider_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_provider_bookings_provider_ref ON public.provider_bookings USING btree (provider, provider_booking_reference);


--
-- Name: idx_provider_bookings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_bookings_status ON public.provider_bookings USING btree (status);


--
-- Name: idx_provider_bookings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_bookings_user ON public.provider_bookings USING btree (user_id);


--
-- Name: idx_reactions_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reactions_post ON public.post_reactions USING btree (post_id);


--
-- Name: idx_reactions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reactions_user ON public.post_reactions USING btree (user_id);


--
-- Name: idx_rec_cache_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rec_cache_expires ON public.recommendation_cache USING btree (expires_at);


--
-- Name: idx_rec_cache_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rec_cache_user ON public.recommendation_cache USING btree (cache_key);


--
-- Name: idx_saves_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saves_user ON public.member_saves USING btree (user_id);


--
-- Name: idx_scheduled_notifications_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_notifications_due ON public.scheduled_notifications USING btree (status, send_at);


--
-- Name: idx_scheduled_notifications_segment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_notifications_segment ON public.scheduled_notifications USING btree (segment_id);


--
-- Name: idx_search_queries_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_search_queries_unique ON public.search_queries USING btree (query, region, category);


--
-- Name: idx_sos_ai_calls_platform_call; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sos_ai_calls_platform_call ON public.sos_ai_calls USING btree (platform, platform_call_id) WHERE (platform_call_id IS NOT NULL);


--
-- Name: idx_sos_ai_calls_sos_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_ai_calls_sos_event ON public.sos_ai_calls USING btree (sos_event_id);


--
-- Name: idx_sos_ai_calls_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_ai_calls_user ON public.sos_ai_calls USING btree (user_id);


--
-- Name: idx_sos_pings; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sos_pings ON public.sos_location_pings USING btree (sos_id, created_at DESC);


--
-- Name: idx_sr_reporter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_reporter ON public.safety_reports USING btree (reporter_id);


--
-- Name: idx_sr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sr_status ON public.safety_reports USING btree (status);


--
-- Name: idx_sub_areas_region_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sub_areas_region_slug ON public.sub_areas USING btree (region, canonical_slug);


--
-- Name: idx_sub_areas_slug_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_areas_slug_trgm ON public.sub_areas USING gin (canonical_slug public.gin_trgm_ops);


--
-- Name: idx_travelers_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_travelers_user_id ON public.travelers USING btree (user_id);


--
-- Name: idx_trip_rsvps_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trip_rsvps_trip ON public.trip_rsvps USING btree (trip_id);


--
-- Name: idx_trip_rsvps_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trip_rsvps_user ON public.trip_rsvps USING btree (user_id);


--
-- Name: idx_trip_segments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trip_segments_user ON public.trip_segments USING btree (user_id, dep_utc);


--
-- Name: idx_tripgic_orders_held_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tripgic_orders_held_sync ON public.tripgic_orders USING btree (last_synced_at NULLS FIRST) WHERE (status = 'held'::text);


--
-- Name: idx_tripgic_orders_quote; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tripgic_orders_quote ON public.tripgic_orders USING btree (quote_id);


--
-- Name: idx_tripgic_orders_tracking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tripgic_orders_tracking ON public.tripgic_orders USING btree (tripgic_tracking_id);


--
-- Name: idx_tripgic_orders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tripgic_orders_user ON public.tripgic_orders USING btree (user_id, created_at DESC);


--
-- Name: idx_trips_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trips_dates ON public.member_trips USING btree (start_date, end_date);


--
-- Name: idx_trips_destination; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trips_destination ON public.member_trips USING btree (destination);


--
-- Name: idx_trips_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trips_public ON public.member_trips USING btree (is_public) WHERE (is_public = true);


--
-- Name: idx_trips_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trips_status ON public.trips USING btree (status);


--
-- Name: idx_trips_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trips_user ON public.member_trips USING btree (user_id);


--
-- Name: idx_user_blocks_blocked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_blocks_blocked ON public.user_blocks USING btree (blocked_id);


--
-- Name: idx_user_blocks_blocker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_blocks_blocker ON public.user_blocks USING btree (blocker_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_waitlist_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_email ON public.waitlist USING btree (email);


--
-- Name: idx_waitlist_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_status ON public.waitlist USING btree (status);


--
-- Name: idx_waitlist_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_token ON public.waitlist USING btree (invite_token);


--
-- Name: uq_flight_orders_payment_intent; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_flight_orders_payment_intent ON public.flight_orders USING btree (payment_intent_id) WHERE (payment_intent_id IS NOT NULL);


--
-- Name: uq_listing_claims_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_listing_claims_pending ON public.listing_claims USING btree (place_id, operator_id) WHERE (status = 'pending'::text);


--
-- Name: post_comments trg_comment_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_comment_count AFTER INSERT OR DELETE ON public.post_comments FOR EACH ROW EXECUTE FUNCTION public.update_comment_count();


--
-- Name: travelers trg_create_member_preferences; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_create_member_preferences AFTER INSERT ON public.travelers FOR EACH ROW EXECUTE FUNCTION public.create_member_preferences();


--
-- Name: post_reactions trg_reaction_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reaction_count AFTER INSERT OR DELETE ON public.post_reactions FOR EACH ROW EXECUTE FUNCTION public.update_reaction_count();


--
-- Name: member_saves trg_save_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_save_count AFTER INSERT OR DELETE ON public.member_saves FOR EACH ROW EXECUTE FUNCTION public.update_save_count();


--
-- Name: bookable_offers bookable_offers_matched_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookable_offers
    ADD CONSTRAINT bookable_offers_matched_operator_id_fkey FOREIGN KEY (matched_operator_id) REFERENCES public.operators(id);


--
-- Name: bookable_offers bookable_offers_place_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookable_offers
    ADD CONSTRAINT bookable_offers_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places_cache(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id);


--
-- Name: bookings bookings_traveler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_traveler_id_fkey FOREIGN KEY (traveler_id) REFERENCES public.travelers(id);


--
-- Name: community_posts community_posts_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id);


--
-- Name: community_posts community_posts_place_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places_cache(id);


--
-- Name: consent_records consent_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: flight_order_events flight_order_events_flight_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_order_events
    ADD CONSTRAINT flight_order_events_flight_order_id_fkey FOREIGN KEY (flight_order_id) REFERENCES public.flight_orders(id);


--
-- Name: flight_order_passengers flight_order_passengers_flight_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_order_passengers
    ADD CONSTRAINT flight_order_passengers_flight_order_id_fkey FOREIGN KEY (flight_order_id) REFERENCES public.flight_orders(id) ON DELETE CASCADE;


--
-- Name: flight_order_passengers flight_order_passengers_traveler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_order_passengers
    ADD CONSTRAINT flight_order_passengers_traveler_id_fkey FOREIGN KEY (traveler_id) REFERENCES public.travelers(id);


--
-- Name: flight_orders flight_orders_markup_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_orders
    ADD CONSTRAINT flight_orders_markup_rule_id_fkey FOREIGN KEY (markup_rule_id) REFERENCES public.markup_rules(id);


--
-- Name: flight_orders flight_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_orders
    ADD CONSTRAINT flight_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: flight_payments flight_payments_flight_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_payments
    ADD CONSTRAINT flight_payments_flight_order_id_fkey FOREIGN KEY (flight_order_id) REFERENCES public.flight_orders(id);


--
-- Name: flight_payments flight_payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_payments
    ADD CONSTRAINT flight_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: identity_verifications identity_verifications_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_verifications
    ADD CONSTRAINT identity_verifications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.travelers(id);


--
-- Name: identity_verifications identity_verifications_traveler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_verifications
    ADD CONSTRAINT identity_verifications_traveler_id_fkey FOREIGN KEY (traveler_id) REFERENCES public.travelers(id);


--
-- Name: in_app_notifications in_app_notifications_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.in_app_notifications
    ADD CONSTRAINT in_app_notifications_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.trip_segments(id) ON DELETE CASCADE;


--
-- Name: in_app_notifications in_app_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.in_app_notifications
    ADD CONSTRAINT in_app_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: listing_claims listing_claims_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_claims
    ADD CONSTRAINT listing_claims_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id);


--
-- Name: listing_claims listing_claims_place_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_claims
    ADD CONSTRAINT listing_claims_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places_cache(id);


--
-- Name: listing_claims listing_claims_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_claims
    ADD CONSTRAINT listing_claims_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: listing_claims listing_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_claims
    ADD CONSTRAINT listing_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: location_history location_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_history
    ADD CONSTRAINT location_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: member_connections member_connections_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_connections
    ADD CONSTRAINT member_connections_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: member_connections member_connections_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_connections
    ADD CONSTRAINT member_connections_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: member_interactions member_interactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_interactions
    ADD CONSTRAINT member_interactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: member_messages member_messages_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_messages
    ADD CONSTRAINT member_messages_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.member_connections(id) ON DELETE CASCADE;


--
-- Name: member_messages member_messages_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_messages
    ADD CONSTRAINT member_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: member_messages member_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_messages
    ADD CONSTRAINT member_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: member_preferences member_preferences_traveler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_preferences
    ADD CONSTRAINT member_preferences_traveler_id_fkey FOREIGN KEY (traveler_id) REFERENCES public.travelers(id) ON DELETE CASCADE;


--
-- Name: member_saves member_saves_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_saves
    ADD CONSTRAINT member_saves_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: member_trips member_trips_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_trips
    ADD CONSTRAINT member_trips_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: operator_trust_scores operator_trust_scores_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_trust_scores
    ADD CONSTRAINT operator_trust_scores_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id);


--
-- Name: operators operators_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: places_cache places_cache_claimed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.places_cache
    ADD CONSTRAINT places_cache_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES public.users(id);


--
-- Name: places_cache places_cache_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.places_cache
    ADD CONSTRAINT places_cache_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id);


--
-- Name: places_cache places_cache_sub_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.places_cache
    ADD CONSTRAINT places_cache_sub_area_id_fkey FOREIGN KEY (sub_area_id) REFERENCES public.sub_areas(id);


--
-- Name: places_cache places_cache_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.places_cache
    ADD CONSTRAINT places_cache_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id);


--
-- Name: post_comments post_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE;


--
-- Name: post_comments post_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: post_media post_media_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_media
    ADD CONSTRAINT post_media_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE;


--
-- Name: post_reactions post_reactions_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_reactions
    ADD CONSTRAINT post_reactions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE;


--
-- Name: post_reactions post_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_reactions
    ADD CONSTRAINT post_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: provider_bookings provider_bookings_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_bookings
    ADD CONSTRAINT provider_bookings_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.bookable_offers(id) ON DELETE SET NULL;


--
-- Name: provider_bookings provider_bookings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_bookings
    ADD CONSTRAINT provider_bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: report_audit_log report_audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_audit_log
    ADD CONSTRAINT report_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: report_audit_log report_audit_log_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_audit_log
    ADD CONSTRAINT report_audit_log_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.safety_reports(id);


--
-- Name: reviews reviews_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: reviews reviews_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.operators(id);


--
-- Name: reviews reviews_traveler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_traveler_id_fkey FOREIGN KEY (traveler_id) REFERENCES public.travelers(id);


--
-- Name: safety_contacts safety_contacts_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_contacts
    ADD CONSTRAINT safety_contacts_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.member_trips(id);


--
-- Name: safety_contacts safety_contacts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_contacts
    ADD CONSTRAINT safety_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: safety_reports safety_reports_reported_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_reports
    ADD CONSTRAINT safety_reports_reported_operator_id_fkey FOREIGN KEY (reported_operator_id) REFERENCES public.operators(id);


--
-- Name: safety_reports safety_reports_reported_place_cache_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_reports
    ADD CONSTRAINT safety_reports_reported_place_cache_id_fkey FOREIGN KEY (reported_place_cache_id) REFERENCES public.places_cache(id);


--
-- Name: safety_reports safety_reports_reported_traveler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_reports
    ADD CONSTRAINT safety_reports_reported_traveler_id_fkey FOREIGN KEY (reported_traveler_id) REFERENCES public.travelers(id);


--
-- Name: safety_reports safety_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_reports
    ADD CONSTRAINT safety_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.travelers(id);


--
-- Name: safety_reports safety_reports_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safety_reports
    ADD CONSTRAINT safety_reports_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.member_trips(id);


--
-- Name: scheduled_notifications scheduled_notifications_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_notifications
    ADD CONSTRAINT scheduled_notifications_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.trip_segments(id) ON DELETE CASCADE;


--
-- Name: scheduled_notifications scheduled_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_notifications
    ADD CONSTRAINT scheduled_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: search_queries search_queries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_queries
    ADD CONSTRAINT search_queries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sos_ai_calls sos_ai_calls_sos_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_ai_calls
    ADD CONSTRAINT sos_ai_calls_sos_event_id_fkey FOREIGN KEY (sos_event_id) REFERENCES public.sos_events(id) ON DELETE CASCADE;


--
-- Name: sos_ai_calls sos_ai_calls_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_ai_calls
    ADD CONSTRAINT sos_ai_calls_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sos_events sos_events_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_events
    ADD CONSTRAINT sos_events_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.travelers(id);


--
-- Name: sos_events sos_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_events
    ADD CONSTRAINT sos_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sos_location_pings sos_location_pings_sos_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_location_pings
    ADD CONSTRAINT sos_location_pings_sos_id_fkey FOREIGN KEY (sos_id) REFERENCES public.sos_events(id);


--
-- Name: sos_responders sos_responders_safety_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_responders
    ADD CONSTRAINT sos_responders_safety_contact_id_fkey FOREIGN KEY (safety_contact_id) REFERENCES public.safety_contacts(id) ON DELETE SET NULL;


--
-- Name: sos_responders sos_responders_sos_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_responders
    ADD CONSTRAINT sos_responders_sos_id_fkey FOREIGN KEY (sos_id) REFERENCES public.sos_events(id);


--
-- Name: sub_area_coverage sub_area_coverage_sub_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_area_coverage
    ADD CONSTRAINT sub_area_coverage_sub_area_id_fkey FOREIGN KEY (sub_area_id) REFERENCES public.sub_areas(id) ON DELETE CASCADE;


--
-- Name: traveler_bans traveler_bans_banned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traveler_bans
    ADD CONSTRAINT traveler_bans_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES public.users(id);


--
-- Name: traveler_bans traveler_bans_lifted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traveler_bans
    ADD CONSTRAINT traveler_bans_lifted_by_fkey FOREIGN KEY (lifted_by) REFERENCES public.users(id);


--
-- Name: traveler_bans traveler_bans_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traveler_bans
    ADD CONSTRAINT traveler_bans_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.safety_reports(id);


--
-- Name: traveler_bans traveler_bans_traveler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traveler_bans
    ADD CONSTRAINT traveler_bans_traveler_id_fkey FOREIGN KEY (traveler_id) REFERENCES public.travelers(id);


--
-- Name: travelers travelers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travelers
    ADD CONSTRAINT travelers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: trip_checkins trip_checkins_traveler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_checkins
    ADD CONSTRAINT trip_checkins_traveler_id_fkey FOREIGN KEY (traveler_id) REFERENCES public.travelers(id);


--
-- Name: trip_checkins trip_checkins_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_checkins
    ADD CONSTRAINT trip_checkins_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.member_trips(id);


--
-- Name: trip_rsvps trip_rsvps_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_rsvps
    ADD CONSTRAINT trip_rsvps_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;


--
-- Name: trip_rsvps trip_rsvps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_rsvps
    ADD CONSTRAINT trip_rsvps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: trip_segments trip_segments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_segments
    ADD CONSTRAINT trip_segments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: tripgic_orders tripgic_orders_markup_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tripgic_orders
    ADD CONSTRAINT tripgic_orders_markup_rule_id_fkey FOREIGN KEY (markup_rule_id) REFERENCES public.markup_rules(id);


--
-- Name: tripgic_orders tripgic_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tripgic_orders
    ADD CONSTRAINT tripgic_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: trips trips_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: user_blocks user_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

