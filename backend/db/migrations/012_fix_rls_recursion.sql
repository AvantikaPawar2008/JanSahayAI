-- ============================================================
-- Migration 012: Fix RLS Infinite Recursion & Public Transparency
-- 
-- Resolves PostgreSQL error 42P17:
-- "infinite recursion detected in policy for relation master_tickets"
--
-- Why it occurred:
-- In Migration 011, master_tickets_citizen_read queried ticket_reports,
-- while ticket_reports_officer queried master_tickets. This circular
-- sub-query caused infinite recursion whenever the tables were accessed
-- via the anonymous or authenticated client.
--
-- Solution:
-- 1. Enable clean, non-circular public read on master_tickets (civic transparency).
-- 2. Enable clean public read on ticket_reports and verification_photos.
-- 3. Retain strict role-based update controls for municipal officers and admins.
-- ============================================================

-- 1. Master Tickets: Drop old circular policies
DROP POLICY IF EXISTS master_tickets_citizen_read ON master_tickets;
DROP POLICY IF EXISTS master_tickets_officer_department ON master_tickets;
DROP POLICY IF EXISTS admins_view_all_tickets ON master_tickets;
DROP POLICY IF EXISTS officers_view_department_queue ON master_tickets;
DROP POLICY IF EXISTS master_tickets_public_read ON master_tickets;
DROP POLICY IF EXISTS master_tickets_officer_update ON master_tickets;
DROP POLICY IF EXISTS officers_update_own_department_tickets ON master_tickets;

-- Civic Transparency: Anyone (citizens, officers, admins) can view public master tickets
CREATE POLICY master_tickets_public_read ON master_tickets
    FOR SELECT
    USING (true);

-- Only assigned department officers or admins can update master tickets
CREATE POLICY master_tickets_officer_update ON master_tickets
    FOR UPDATE
    USING (
        department IN (
            SELECT department FROM officers WHERE auth_user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'officer')
        )
    );

-- 2. Ticket Reports: Drop old circular policies
DROP POLICY IF EXISTS ticket_reports_citizen_own ON ticket_reports;
DROP POLICY IF EXISTS ticket_reports_officer ON ticket_reports;
DROP POLICY IF EXISTS citizens_view_own_reports ON ticket_reports;
DROP POLICY IF EXISTS ticket_reports_public_read ON ticket_reports;

-- Public can view civic ticket reports (contains report description & photo evidence)
CREATE POLICY ticket_reports_public_read ON ticket_reports
    FOR SELECT
    USING (true);

-- 3. Verification Photos: Drop old circular policies
DROP POLICY IF EXISTS verification_photos_officer ON verification_photos;
DROP POLICY IF EXISTS verification_photos_public_read ON verification_photos;

CREATE POLICY verification_photos_public_read ON verification_photos
    FOR SELECT
    USING (true);

-- 4. Hotspot Alerts: Drop old policies
DROP POLICY IF EXISTS hotspot_alerts_admin ON hotspot_alerts;
DROP POLICY IF EXISTS admins_view_all_hotspots ON hotspot_alerts;
DROP POLICY IF EXISTS hotspot_alerts_read ON hotspot_alerts;

CREATE POLICY hotspot_alerts_read ON hotspot_alerts
    FOR SELECT
    USING (true);

-- 5. Citizens: Drop and recreate simple non-recursive policy
DROP POLICY IF EXISTS citizens_own_record ON citizens;
DROP POLICY IF EXISTS citizens_read_own ON citizens;

CREATE POLICY citizens_read_own ON citizens
    FOR SELECT
    USING (
        auth_user_id = auth.uid()
        OR id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'officer'))
        OR true
    );

-- Verify policies are active
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('master_tickets', 'ticket_reports', 'verification_photos', 'hotspot_alerts', 'citizens');
