-- Migration 010: Master Architecture Improvements & Audit Provenance
-- Run in Supabase SQL Editor

-- ============================================================
-- 1. IMMUTABLE AUDIT LOG: ticket_events
-- ============================================================
CREATE TABLE IF NOT EXISTS ticket_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES master_tickets(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_id UUID,
    actor_role TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    model_version TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_id ON ticket_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_event_type ON ticket_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ticket_events_created_at ON ticket_events(created_at DESC);

-- Enable RLS on ticket_events
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view ticket events" ON ticket_events;
CREATE POLICY "Anyone can view ticket events"
    ON ticket_events FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Service role full access on ticket_events" ON ticket_events;
CREATE POLICY "Service role full access on ticket_events"
    ON ticket_events FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- 2. IDEMPOTENCY & CLIENT ACCURACY on ticket_reports
-- ============================================================
ALTER TABLE ticket_reports ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;
ALTER TABLE ticket_reports ADD COLUMN IF NOT EXISTS client_accuracy DOUBLE PRECISION;
ALTER TABLE ticket_reports ADD COLUMN IF NOT EXISTS is_mock_location BOOLEAN DEFAULT false;

-- ============================================================
-- 3. AUDIT PROVENANCE, RECURRENCE & WARRANTY on master_tickets
-- ============================================================
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS dedup_similarity_score DOUBLE PRECISION;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS dedup_threshold_zone TEXT;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS dedup_laya_decision TEXT;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS triage_confidence DOUBLE PRECISION;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS recurrence_count INTEGER DEFAULT 0;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS warranty_until TIMESTAMPTZ;
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS contractor_id UUID REFERENCES officers(id);
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS citizen_confirmation_status TEXT DEFAULT 'PENDING';
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS citizen_dispute_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_master_tickets_recurrence_count ON master_tickets(recurrence_count);
CREATE INDEX IF NOT EXISTS idx_master_tickets_warranty_until ON master_tickets(warranty_until);

-- ============================================================
-- 4. CIVIC KARMA on citizens
-- ============================================================
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS civic_karma DOUBLE PRECISION DEFAULT 1.0;

-- ============================================================
-- 5. METRIC-ACCURATE DBSCAN FUNCTION (UTM 43N / EPSG:32643)
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
            -- Project into UTM Zone 43N (EPSG:32643) so units of eps are true ground meters
            ST_ClusterDBSCAN(
                ST_Transform(mt.location::geometry, 32643),
                eps := eps_meters,
                minpoints := min_pts
            ) OVER (PARTITION BY mt.department, mt.sub_category) AS cluster_id
        FROM master_tickets mt
        WHERE mt.status NOT IN ('RESOLVED', 'CLOSED')
          AND mt.department IS NOT NULL
          AND mt.sub_category IS NOT NULL
          AND mt.needs_admin_review IS NOT TRUE
          AND mt.created_at >= NOW() - (hours_window || ' hours')::INTERVAL
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
                  AND (cen.sub_category IS NULL OR c2.sub_category = cen.sub_category)
            ), eps_meters)
        ) AS radius_m,
        cen.c_count AS ticket_count,
        cen.c_ticket_ids AS ticket_ids
    FROM cluster_centroids cen;
END;
$$ LANGUAGE plpgsql;
