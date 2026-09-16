-- CivicPulse Migration 003: Department Enum, Needs Review Flag, Audit Columns, and Strict Officer RLS

-- 1. Create department_type enum if it doesn't already exist
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

-- 2. Add needs_admin_review and reclassification audit columns to master_tickets
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS needs_admin_review BOOLEAN DEFAULT false;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS department_reassigned_by UUID REFERENCES auth.users(id);
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS department_reassigned_at TIMESTAMPTZ;

-- 3. Normalize existing records to ensure they match enum values before conversion
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

-- 4. Convert department columns to department_type enum
DO $$ BEGIN
  ALTER TABLE master_tickets ALTER COLUMN department TYPE department_type USING department::text::department_type;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE profiles ALTER COLUMN department TYPE department_type USING department::text::department_type;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 5. Enforce strict Officer RLS: block any cross-department viewing
-- Note: using explicit ::text cast so it works cleanly across any type
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

-- 6. Ensure admin can view all tickets including unassigned or misclassified
DROP POLICY IF EXISTS "admins_view_all_tickets" ON master_tickets;
CREATE POLICY "admins_view_all_tickets"
ON master_tickets FOR SELECT
USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- 7. Ensure admin can update all tickets (for reassignment)
DROP POLICY IF EXISTS "admins_update_all_tickets" ON master_tickets;
CREATE POLICY "admins_update_all_tickets"
ON master_tickets FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- 8. Citizens can view master tickets referenced in their reports or for public tracking
DROP POLICY IF EXISTS "citizens_view_tracking_tickets" ON master_tickets;
CREATE POLICY "citizens_view_tracking_tickets"
ON master_tickets FOR SELECT
USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'citizen')
  OR auth.uid() IS NULL
);
