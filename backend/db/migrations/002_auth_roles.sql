-- CivicPulse Migration 002: Auth Roles, Profiles, RLS, and Priority Breakdown

-- 1. Create user_role enum
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('citizen', 'officer', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role user_role NOT NULL DEFAULT 'citizen',
  full_name TEXT,
  phone_number TEXT,
  department TEXT,              -- only populated for officers; must match master_tickets.department
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Trigger to create profile when auth.users record is created
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

-- 4. Add priority sub-score columns for the breakdown UI
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS priority_score numeric;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS priority_sla_component numeric;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS priority_urgency_component numeric;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS priority_duplicate_component numeric;

-- 5. Enable RLS
ALTER TABLE master_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotspot_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 6. Profile policies
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

-- 7. Role-based policies
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
    AND profiles.department = master_tickets.department::text
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
    AND profiles.department = master_tickets.department::text
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
