-- CivicPulse Database Schema
-- Run this in the Supabase SQL Editor (one-time setup)
-- Requires extensions: postgis, vector

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 2. ENUM TYPES
-- ============================================================
DO $$ BEGIN
    CREATE TYPE urgency_level AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE ticket_status AS ENUM (
        'OPEN',
        'ASSIGNED',
        'IN_PROGRESS',
        'RESOLVED_PENDING_CITIZEN',
        'RESOLVED',
        'REOPENED',
        'CLOSED'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE department_type AS ENUM (
        'Water Supply & Sewerage',
        'Roads & Infrastructure',
        'Solid Waste Management',
        'Electrical & Streetlighting',
        'Health & Sanitation'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE photo_type AS ENUM ('before', 'after');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE alert_status AS ENUM ('NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('citizen', 'officer', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 3. TABLES
-- ============================================================

-- Citizens table
CREATE TABLE IF NOT EXISTS citizens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_number TEXT,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Officers table
CREATE TABLE IF NOT EXISTS officers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    department department_type NOT NULL,
    phone_number TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Master tickets — one per unique physical issue
CREATE TABLE IF NOT EXISTS master_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL,
    department department_type,
    urgency urgency_level DEFAULT 'MEDIUM',
    status ticket_status DEFAULT 'OPEN',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    location geography(POINT, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    ) STORED,
    sop_steps JSONB DEFAULT '[]'::jsonb,
    tools_required JSONB DEFAULT '[]'::jsonb,
    citizen_sms_draft TEXT,
    assigned_officer_id UUID REFERENCES officers(id),
    upvote_count INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    description TEXT,
    sub_category TEXT,
    needs_admin_review BOOLEAN DEFAULT false,
    department_reassigned_by UUID REFERENCES auth.users(id),
    department_reassigned_at TIMESTAMPTZ
);

-- Individual citizen reports linked to a master ticket
CREATE TABLE IF NOT EXISTS ticket_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_ticket_id UUID NOT NULL REFERENCES master_tickets(id) ON DELETE CASCADE,
    citizen_id UUID REFERENCES citizens(id),
    raw_text TEXT,
    transcript TEXT,
    translated_text TEXT,
    image_url TEXT,
    text_embedding vector(384),
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    location_source TEXT DEFAULT 'gps',
    location geography(POINT, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Before/after verification photos from field officers
CREATE TABLE IF NOT EXISTS verification_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_ticket_id UUID NOT NULL REFERENCES master_tickets(id) ON DELETE CASCADE,
    officer_id UUID REFERENCES officers(id),
    photo_type photo_type NOT NULL,
    image_url TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    location geography(POINT, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    ) STORED,
    captured_at TIMESTAMPTZ DEFAULT now(),
    fraud_check_passed BOOLEAN,
    fraud_check_notes TEXT
);

-- Hotspot infrastructure alerts
CREATE TABLE IF NOT EXISTS hotspot_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL,
    center_lat DOUBLE PRECISION NOT NULL,
    center_lng DOUBLE PRECISION NOT NULL,
    radius_m DOUBLE PRECISION DEFAULT 100,
    ticket_count INTEGER DEFAULT 0,
    ticket_ids UUID[] DEFAULT '{}',
    status alert_status DEFAULT 'NEW',
    root_cause_analysis TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- User profiles (links auth.users to roles)
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'citizen',
    name TEXT NOT NULL,
    phone_number TEXT,
    department department_type,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. INDEXES
-- ============================================================

-- Spatial indexes (GIST) for fast geographic queries
CREATE INDEX IF NOT EXISTS idx_master_tickets_location
    ON master_tickets USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_ticket_reports_location
    ON ticket_reports USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_verification_photos_location
    ON verification_photos USING GIST (location);

-- Vector indexes (HNSW) for fast similarity search
CREATE INDEX IF NOT EXISTS idx_ticket_reports_text_embedding
    ON ticket_reports USING hnsw (text_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Status + urgency indexes for officer queue queries
CREATE INDEX IF NOT EXISTS idx_master_tickets_status
    ON master_tickets (status);

CREATE INDEX IF NOT EXISTS idx_master_tickets_urgency
    ON master_tickets (urgency);

CREATE INDEX IF NOT EXISTS idx_master_tickets_department
    ON master_tickets (department);

CREATE INDEX IF NOT EXISTS idx_master_tickets_created_at
    ON master_tickets (created_at DESC);

-- Hotspot alert indexes
CREATE INDEX IF NOT EXISTS idx_hotspot_alerts_status
    ON hotspot_alerts (status);

CREATE INDEX IF NOT EXISTS idx_hotspot_alerts_created_at
    ON hotspot_alerts (created_at DESC);

-- ============================================================
-- 5. ROW LEVEL SECURITY (basic policies)
-- ============================================================

ALTER TABLE master_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotspot_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizens ENABLE ROW LEVEL SECURITY;
ALTER TABLE officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read master tickets
DROP POLICY IF EXISTS "Anyone can view master tickets" ON master_tickets;
CREATE POLICY "Anyone can view master tickets"
    ON master_tickets FOR SELECT
    TO authenticated
    USING (true);

-- Allow service role full access (backend uses service role key)
DROP POLICY IF EXISTS "Service role full access on master_tickets" ON master_tickets;
CREATE POLICY "Service role full access on master_tickets"
    ON master_tickets FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on ticket_reports" ON ticket_reports;
CREATE POLICY "Service role full access on ticket_reports"
    ON ticket_reports FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on verification_photos" ON verification_photos;
CREATE POLICY "Service role full access on verification_photos"
    ON verification_photos FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on hotspot_alerts" ON hotspot_alerts;
CREATE POLICY "Service role full access on hotspot_alerts"
    ON hotspot_alerts FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on citizens" ON citizens;
CREATE POLICY "Service role full access on citizens"
    ON citizens FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on officers" ON officers;
CREATE POLICY "Service role full access on officers"
    ON officers FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on user_profiles" ON user_profiles;
CREATE POLICY "Service role full access on user_profiles"
    ON user_profiles FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow anon/authenticated read on select tables for frontend
DROP POLICY IF EXISTS "Anon can read master_tickets" ON master_tickets;
CREATE POLICY "Anon can read master_tickets"
    ON master_tickets FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS "Anon can insert ticket_reports" ON ticket_reports;
CREATE POLICY "Anon can insert ticket_reports"
    ON ticket_reports FOR INSERT
    TO anon
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read verification_photos" ON verification_photos;
CREATE POLICY "Authenticated read verification_photos"
    ON verification_photos FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Authenticated read hotspot_alerts" ON hotspot_alerts;
CREATE POLICY "Authenticated read hotspot_alerts"
    ON hotspot_alerts FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
CREATE POLICY "Users can read own profile"
    ON user_profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = auth_user_id);

-- ============================================================
-- 6. STORAGE BUCKET (run separately if needed)
-- ============================================================
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('complaint-media', 'complaint-media', true)
-- ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 7. AUTH ROLES, PROFILES & ROLE POLICIES (Migration 002)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('citizen', 'officer', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role user_role NOT NULL DEFAULT 'citizen',
  full_name TEXT,
  phone_number TEXT,
  department TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION handle_new_user() RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, phone_number)
  VALUES (
    new.id,
    'citizen',
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    COALESCE(new.raw_user_meta_data->>'phone_number', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- Add priority sub-score columns for the breakdown UI
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS priority_score numeric;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS priority_sla_component numeric;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS priority_urgency_component numeric;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS priority_duplicate_component numeric;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile"
ON profiles FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Service role full access on profiles" ON profiles;
CREATE POLICY "Service role full access on profiles"
ON profiles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "citizens_view_own_reports" ON ticket_reports;
CREATE POLICY "citizens_view_own_reports"
ON ticket_reports FOR SELECT
USING (
  citizen_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'officer'))
);

DROP POLICY IF EXISTS "officers_view_department_queue" ON master_tickets;
CREATE POLICY "officers_view_department_queue"
ON master_tickets FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'officer' 
    AND profiles.department::text = master_tickets.department::text
  )
);

DROP POLICY IF EXISTS "officers_update_own_department_tickets" ON master_tickets;
CREATE POLICY "officers_update_own_department_tickets"
ON master_tickets FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'officer' 
    AND profiles.department::text = master_tickets.department::text
  )
);

DROP POLICY IF EXISTS "admins_view_all_tickets" ON master_tickets;
CREATE POLICY "admins_view_all_tickets"
ON master_tickets FOR SELECT
USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

DROP POLICY IF EXISTS "admins_view_all_hotspots" ON hotspot_alerts;
CREATE POLICY "admins_view_all_hotspots"
ON hotspot_alerts FOR SELECT
USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- ============================================================
-- 10. MIGRATION 003: DEPARTMENT ENUM & STRICT OFFICER QUEUE RLS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE department_type AS ENUM (
    'Water Supply & Sewerage',
    'Roads & Infrastructure',
    'Solid Waste Management',
    'Electrical & Streetlighting',
    'Health & Sanitation'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS needs_admin_review BOOLEAN DEFAULT false;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS department_reassigned_by UUID REFERENCES auth.users(id);
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS department_reassigned_at TIMESTAMPTZ;

-- Normalize existing records to ensure they match enum values before conversion
UPDATE master_tickets
SET department = 'Roads & Infrastructure'
WHERE department IS NOT NULL AND department::text NOT IN (
  'Water Supply & Sewerage',
  'Roads & Infrastructure',
  'Solid Waste Management',
  'Electrical & Streetlighting',
  'Health & Sanitation'
);

UPDATE profiles
SET department = 'Roads & Infrastructure'
WHERE department IS NOT NULL AND department::text NOT IN (
  'Water Supply & Sewerage',
  'Roads & Infrastructure',
  'Solid Waste Management',
  'Electrical & Streetlighting',
  'Health & Sanitation'
);

-- Lock department columns to department_type enum
DO $$ BEGIN
  ALTER TABLE master_tickets ALTER COLUMN department TYPE department_type USING department::text::department_type;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE profiles ALTER COLUMN department TYPE department_type USING department::text::department_type;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Strict officer RLS policy: view ONLY own department tickets
DROP POLICY IF EXISTS "Anyone can view master tickets" ON master_tickets;
DROP POLICY IF EXISTS "officers_view_department_queue" ON master_tickets;
DROP POLICY IF EXISTS "officers_view_own_department_only" ON master_tickets;

CREATE POLICY "officers_view_own_department_only"
ON master_tickets FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'officer'
    AND profiles.department::text = master_tickets.department::text
  )
);

-- Allow admin full update access for reassigning departments
DROP POLICY IF EXISTS "admins_update_all_tickets" ON master_tickets;
CREATE POLICY "admins_update_all_tickets"
ON master_tickets FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- ============================================================
-- 11. GEOSPATIAL CLUSTERING & DEDUPLICATION FUNCTIONS (Migration 005)
-- ============================================================

DROP FUNCTION IF EXISTS find_nearby_tickets(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) CASCADE;
DROP FUNCTION IF EXISTS detect_hotspot_clusters(DOUBLE PRECISION, INTEGER, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS increment_ticket_upvote(UUID) CASCADE;
DROP FUNCTION IF EXISTS find_nearby_hotspots(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) CASCADE;
DROP FUNCTION IF EXISTS find_nearby_hotspots(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) CASCADE;

-- Function: Find nearby tickets for deduplication
CREATE OR REPLACE FUNCTION find_nearby_tickets(
    search_lat DOUBLE PRECISION,
    search_lng DOUBLE PRECISION,
    radius_m DOUBLE PRECISION DEFAULT 100
)
RETURNS TABLE (
    id UUID,
    category TEXT,
    sub_category TEXT,
    department department_type,
    urgency urgency_level,
    status ticket_status,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    upvote_count INTEGER,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mt.id,
        mt.category,
        mt.sub_category,
        mt.department,
        mt.urgency,
        mt.status,
        mt.lat,
        mt.lng,
        mt.upvote_count,
        mt.created_at
    FROM master_tickets mt
    WHERE mt.status NOT IN ('RESOLVED', 'CLOSED')
    AND ST_DWithin(
        mt.location,
        ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography,
        radius_m
    );
END;
$$ LANGUAGE plpgsql;

-- Function: Detect hotspot clusters using metric DBSCAN (EPSG:3857)
CREATE OR REPLACE FUNCTION detect_hotspot_clusters(
    eps_meters DOUBLE PRECISION DEFAULT 100,
    min_pts INTEGER DEFAULT 5,
    hours_window INTEGER DEFAULT 72
)
RETURNS TABLE (
    category TEXT,
    center_lat DOUBLE PRECISION,
    center_lng DOUBLE PRECISION,
    radius_m DOUBLE PRECISION,
    ticket_count BIGINT,
    ticket_ids UUID[]
) AS $$
BEGIN
    RETURN QUERY
    WITH clustered AS (
        SELECT
            mt.id,
            mt.category,
            mt.lat,
            mt.lng,
            mt.location,
            -- Project to Web Mercator (meters) so eps operates on true meters!
            ST_ClusterDBSCAN(
                ST_Transform(mt.location::geometry, 3857),
                eps := eps_meters,
                minpoints := min_pts
            ) OVER (PARTITION BY mt.category) AS cluster_id
        FROM master_tickets mt
        WHERE mt.created_at >= NOW() - (hours_window || ' hours')::INTERVAL
          AND mt.status NOT IN ('RESOLVED', 'CLOSED')
    )
    SELECT
        c.category,
        AVG(c.lat) AS center_lat,
        AVG(c.lng) AS center_lng,
        GREATEST(
            eps_meters,
            COALESCE(
                MAX(
                    ST_Distance(
                        c.location,
                        ST_SetSRID(ST_MakePoint(AVG(c.lng), AVG(c.lat)), 4326)::geography
                    )
                ),
                eps_meters
            )
        ) AS radius_m,
        COUNT(*)::BIGINT AS ticket_count,
        ARRAY_AGG(c.id) AS ticket_ids
    FROM clustered c
    WHERE c.cluster_id IS NOT NULL
    GROUP BY c.category, c.cluster_id
    HAVING COUNT(*) >= min_pts;
END;
$$ LANGUAGE plpgsql;

-- Function: Atomic ticket upvote increment
CREATE OR REPLACE FUNCTION increment_ticket_upvote(target_ticket_id UUID)
RETURNS INTEGER AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE master_tickets
    SET upvote_count = COALESCE(upvote_count, 1) + 1
    WHERE id = target_ticket_id
    RETURNING upvote_count INTO new_count;
    
    RETURN new_count;
END;
$$ LANGUAGE plpgsql;

-- Function: Find nearby hotspots
CREATE OR REPLACE FUNCTION find_nearby_hotspots(
    search_lat DOUBLE PRECISION,
    search_lng DOUBLE PRECISION,
    radius_m DOUBLE PRECISION DEFAULT 200,
    search_category TEXT DEFAULT '',
    search_sub_category TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, category TEXT, status alert_status) AS $$
BEGIN
    RETURN QUERY
    SELECT ha.id, ha.category, ha.status
    FROM hotspot_alerts ha
    WHERE ha.category = search_category
      AND ha.status NOT IN ('RESOLVED')
      AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(ha.center_lng, ha.center_lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography,
          radius_m
      );
END;
$$ LANGUAGE plpgsql;


