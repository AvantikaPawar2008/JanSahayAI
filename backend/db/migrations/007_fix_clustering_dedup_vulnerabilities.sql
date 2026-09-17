-- CivicPulse Migration 007: Fix Clustering, Deduplication & Access-Control Vulnerabilities
-- 1. Add missing columns (department, sub_category) and indexes to hotspot_alerts
-- 2. Restore rolling time window (hours_window) and partition by (department, sub_category) in detect_hotspot_clusters
-- 3. Enforce department + sub_category hard filter inside find_nearby_tickets
-- 4. Fix NULL-matching bug in find_nearby_hotspots (strict department and sub_category match)
-- 5. Replace freely-callable increment_ticket_upvote RPC with trigger-derived sync_ticket_upvote_count
-- 6. Close anon/public data leaks in RLS policies for master_tickets and hotspot_alerts

-- ============================================================
-- FIX 1: Add missing columns to hotspot_alerts table
-- ============================================================
DO $$ BEGIN
    ALTER TABLE hotspot_alerts ADD COLUMN IF NOT EXISTS department department_type;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE hotspot_alerts ADD COLUMN IF NOT EXISTS sub_category TEXT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_hotspot_alerts_department ON hotspot_alerts (department);
CREATE INDEX IF NOT EXISTS idx_hotspot_alerts_sub_category ON hotspot_alerts (sub_category);

-- ============================================================
-- FIX 2: Restore rolling time window and department+sub_category partitioning
-- ============================================================
DROP FUNCTION IF EXISTS detect_hotspot_clusters(DOUBLE PRECISION, INTEGER, INTEGER) CASCADE;

CREATE OR REPLACE FUNCTION detect_hotspot_clusters(
    eps_meters DOUBLE PRECISION DEFAULT 100,
    min_pts INTEGER DEFAULT 5,
    hours_window INTEGER DEFAULT 72
)
RETURNS TABLE (
    category TEXT,
    sub_category TEXT,
    department department_type,
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
            mt.id, mt.category, mt.sub_category, mt.department, mt.lat, mt.lng, mt.location,
            -- FIX: partition by BOTH department and sub_category, and exclude
            -- unclassified tickets entirely so NULLs never cluster together
            ST_ClusterDBSCAN(
                ST_Transform(mt.location::geometry, 3857),
                eps := eps_meters,
                minpoints := min_pts
            ) OVER (PARTITION BY mt.department, mt.sub_category) AS cluster_id
        FROM master_tickets mt
        WHERE mt.status NOT IN ('RESOLVED', 'CLOSED')
          AND mt.department IS NOT NULL
          AND mt.sub_category IS NOT NULL
          AND mt.needs_admin_review IS NOT TRUE                          -- Exclude misclassified tickets from clustering
          AND mt.created_at >= NOW() - (hours_window || ' hours')::INTERVAL  -- Restored rolling window
    ),
    cluster_centroids AS (
        SELECT
            c.department, c.sub_category, c.cluster_id,
            MODE() WITHIN GROUP (ORDER BY c.category) AS primary_category,
            AVG(c.lat) AS c_lat, AVG(c.lng) AS c_lng,
            COUNT(*)::BIGINT AS c_count,
            ARRAY_AGG(c.id) AS c_ticket_ids
        FROM clustered c
        WHERE c.cluster_id IS NOT NULL
        GROUP BY c.department, c.sub_category, c.cluster_id
        HAVING COUNT(*) >= min_pts
    )
    SELECT
        cen.primary_category AS category,
        cen.sub_category,
        cen.department,
        cen.c_lat AS center_lat,
        cen.c_lng AS center_lng,
        GREATEST(
            eps_meters,
            COALESCE((
                SELECT MAX(ST_Distance(c2.location, ST_SetSRID(ST_MakePoint(cen.c_lng, cen.c_lat), 4326)::geography))
                FROM clustered c2
                WHERE c2.cluster_id = cen.cluster_id
                  AND c2.department = cen.department
                  AND c2.sub_category = cen.sub_category
            ), eps_meters)
        ) AS radius_m,
        cen.c_count AS ticket_count,
        cen.c_ticket_ids AS ticket_ids
    FROM cluster_centroids cen;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FIX 3: Enforce department + sub_category hard filter inside find_nearby_tickets
-- ============================================================
DROP FUNCTION IF EXISTS find_nearby_tickets(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) CASCADE;
DROP FUNCTION IF EXISTS find_nearby_tickets(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, department_type, TEXT) CASCADE;
DROP FUNCTION IF EXISTS find_nearby_tickets(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION find_nearby_tickets(
    search_lat DOUBLE PRECISION,
    search_lng DOUBLE PRECISION,
    radius_m DOUBLE PRECISION DEFAULT 100,
    search_department department_type DEFAULT NULL,
    search_sub_category TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID, category TEXT, sub_category TEXT, department department_type,
    urgency urgency_level, status ticket_status, lat DOUBLE PRECISION, lng DOUBLE PRECISION,
    upvote_count INTEGER, created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT mt.id, mt.category, mt.sub_category, mt.department, mt.urgency, mt.status,
           mt.lat, mt.lng, mt.upvote_count, mt.created_at
    FROM master_tickets mt
    WHERE mt.status NOT IN ('RESOLVED', 'CLOSED')
      AND (search_department IS NULL OR mt.department = search_department)
      AND (search_sub_category IS NULL OR mt.sub_category = search_sub_category)
      AND ST_DWithin(
          mt.location,
          ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography,
          radius_m
      );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FIX 4: Fix NULL-matching bug in find_nearby_hotspots
-- ============================================================
DROP FUNCTION IF EXISTS find_nearby_hotspots(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) CASCADE;
DROP FUNCTION IF EXISTS find_nearby_hotspots(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS find_nearby_hotspots(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, department_type, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION find_nearby_hotspots(
    search_lat DOUBLE PRECISION,
    search_lng DOUBLE PRECISION,
    radius_m DOUBLE PRECISION DEFAULT 200,
    search_department department_type DEFAULT NULL,
    search_sub_category TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, category TEXT, status alert_status) AS $$
BEGIN
    RETURN QUERY
    SELECT ha.id, ha.category, ha.status
    FROM hotspot_alerts ha
    WHERE ha.department = search_department          -- exact match only, no NULL wildcard
      AND ha.sub_category = search_sub_category       -- exact match only, no NULL wildcard
      AND ha.status NOT IN ('RESOLVED')
      AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(ha.center_lng, ha.center_lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography,
          radius_m
      );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FIX 5: Replace freely-callable upvote RPC with trigger-derived count
-- ============================================================
-- Drop the old freely-callable increment function
DROP FUNCTION IF EXISTS increment_ticket_upvote(UUID) CASCADE;

-- Derive upvote_count automatically from actual linked reports
CREATE OR REPLACE FUNCTION sync_ticket_upvote_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE master_tickets
    SET upvote_count = (SELECT COUNT(*) FROM ticket_reports WHERE master_ticket_id = NEW.master_ticket_id)
    WHERE id = NEW.master_ticket_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE master_tickets
    SET upvote_count = (SELECT COUNT(*) FROM ticket_reports WHERE master_ticket_id = OLD.master_ticket_id)
    WHERE id = OLD.master_ticket_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_ticket_report_change ON ticket_reports;
CREATE TRIGGER on_ticket_report_change
  AFTER INSERT OR DELETE ON ticket_reports
  FOR EACH ROW EXECUTE PROCEDURE sync_ticket_upvote_count();

-- ============================================================
-- FIX 6: Close anon/public data leaks in RLS policies
-- ============================================================
-- Remove permissive legacy policies
DROP POLICY IF EXISTS "Anon can read master_tickets" ON master_tickets;
DROP POLICY IF EXISTS "Authenticated read hotspot_alerts" ON hotspot_alerts;
DROP POLICY IF EXISTS "admins_view_all_hotspots" ON hotspot_alerts;
DROP POLICY IF EXISTS "citizens_view_tracking_tickets" ON master_tickets;
DROP POLICY IF EXISTS "citizens_view_linked_tickets" ON master_tickets;

-- Citizens can view a specific master ticket only if they have a linked report on it
CREATE POLICY "citizens_view_linked_tickets"
ON master_tickets FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM ticket_reports tr
    WHERE tr.master_ticket_id = master_tickets.id
    AND tr.citizen_id = auth.uid()
  )
);

-- Admin-only hotspot alert view (explicit scoped security instead of authenticated blanket access)
DROP POLICY IF EXISTS "admins_view_hotspot_alerts" ON hotspot_alerts;
CREATE POLICY "admins_view_hotspot_alerts"
ON hotspot_alerts FOR SELECT
USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
