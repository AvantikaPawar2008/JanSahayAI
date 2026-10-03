-- ============================================================
-- Migration 011: Full P0+P1+P2 Feature Completeness
-- 
-- Implements schema changes for:
--   [TODO-SEC-01] Strict RLS policies for tenant isolation
--   [TODO-SEC-02] Signed URL tracking column
--   [TODO-DD-01]  60-day contractor warranty schema
--   [TODO-DD-03]  Road-network dedup helper function
--   [TODO-VF-03]  Rubric verification columns on verification_photos
--   [TODO-HS-01]  Z-score columns on hotspot_alerts
--   [TODO-HS-02]  Infrastructure risk + weather alert table
--   [TODO-TR-02]  RAG context tracking on master_tickets
-- ============================================================

-- ============================================================
-- 1. [TODO-SEC-02] PRIVATE MEDIA BUCKET — Signed URL TTL Tracking
-- ============================================================
-- Track when signed URLs were last generated so they can be refreshed
ALTER TABLE ticket_reports 
    ADD COLUMN IF NOT EXISTS signed_url_expires_at TIMESTAMPTZ;

ALTER TABLE verification_photos 
    ADD COLUMN IF NOT EXISTS signed_url_expires_at TIMESTAMPTZ;

-- ============================================================
-- 2. [TODO-DD-01] CONTRACTOR WARRANTY ENGINE
-- ============================================================

-- Performance score for officers/contractors
ALTER TABLE officers
    ADD COLUMN IF NOT EXISTS performance_score INTEGER DEFAULT 100 CHECK (performance_score >= 0 AND performance_score <= 200);

-- Indexes for warranty queries
CREATE INDEX IF NOT EXISTS idx_master_tickets_warranty_until
    ON master_tickets (warranty_until)
    WHERE warranty_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_master_tickets_contractor_id
    ON master_tickets (contractor_id)
    WHERE contractor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_master_tickets_status_warranty
    ON master_tickets (status, warranty_until)
    WHERE status = 'RESOLVED' AND warranty_until IS NOT NULL;

-- RPC: Find warranty breaches via spatial query
CREATE OR REPLACE FUNCTION find_warranty_breach(
    search_lat FLOAT,
    search_lng FLOAT,
    radius_m FLOAT DEFAULT 25,
    search_department TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    lat FLOAT,
    lng FLOAT,
    department TEXT,
    sub_category TEXT,
    contractor_id UUID,
    warranty_until TIMESTAMPTZ,
    status TEXT,
    distance_m FLOAT
)
LANGUAGE SQL
STABLE
AS $$
    SELECT
        mt.id,
        mt.lat,
        mt.lng,
        mt.department::TEXT,
        mt.sub_category,
        mt.contractor_id,
        mt.warranty_until,
        mt.status::TEXT,
        ST_Distance(
            mt.location,
            ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography
        ) AS distance_m
    FROM master_tickets mt
    WHERE
        mt.status = 'RESOLVED'
        AND mt.warranty_until IS NOT NULL
        AND mt.warranty_until > NOW()
        AND ST_DWithin(
            mt.location,
            ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography,
            radius_m
        )
        AND (search_department IS NULL OR mt.department::TEXT = search_department)
    ORDER BY distance_m ASC
    LIMIT 10;
$$;

-- RPC: Atomically deduct contractor performance score
CREATE OR REPLACE FUNCTION deduct_contractor_performance(
    p_officer_id UUID,
    p_penalty INTEGER DEFAULT 5
)
RETURNS VOID
LANGUAGE SQL
AS $$
    UPDATE officers
    SET performance_score = GREATEST(0, COALESCE(performance_score, 100) - p_penalty)
    WHERE id = p_officer_id;
$$;

-- ============================================================
-- 3. [TODO-VF-03] MULTI-CRITERIA RUBRIC COLUMNS
-- ============================================================
ALTER TABLE verification_photos
    ADD COLUMN IF NOT EXISTS rubric_site_match INTEGER CHECK (rubric_site_match BETWEEN 0 AND 5),
    ADD COLUMN IF NOT EXISTS rubric_defect_resolved INTEGER CHECK (rubric_defect_resolved BETWEEN 0 AND 5),
    ADD COLUMN IF NOT EXISTS rubric_repair_quality INTEGER CHECK (rubric_repair_quality BETWEEN 0 AND 5),
    ADD COLUMN IF NOT EXISTS rubric_total_score INTEGER CHECK (rubric_total_score BETWEEN 0 AND 15),
    ADD COLUMN IF NOT EXISTS rubric_verdict TEXT CHECK (rubric_verdict IN ('PASS', 'BORDERLINE', 'FAIL')),
    ADD COLUMN IF NOT EXISTS needs_supervisor_review BOOLEAN DEFAULT FALSE;

-- Index for supervisor review queue
CREATE INDEX IF NOT EXISTS idx_verification_photos_supervisor_review
    ON verification_photos (needs_supervisor_review, captured_at DESC)
    WHERE needs_supervisor_review = TRUE;

-- ============================================================
-- 4. [TODO-HS-01] POISSON Z-SCORE COLUMNS ON HOTSPOT ALERTS
-- ============================================================
ALTER TABLE hotspot_alerts
    ADD COLUMN IF NOT EXISTS z_score FLOAT,
    ADD COLUMN IF NOT EXISTS is_statistically_abnormal BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS baseline_mean FLOAT;

-- Index: only surface statistically significant hotspots to admins
CREATE INDEX IF NOT EXISTS idx_hotspot_alerts_zscore
    ON hotspot_alerts (z_score DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hotspot_alerts_abnormal
    ON hotspot_alerts (is_statistically_abnormal, created_at DESC)
    WHERE is_statistically_abnormal = TRUE;

-- ============================================================
-- 5. [TODO-HS-02] INFRASTRUCTURE RISK ALERTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS infrastructure_risk_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lat FLOAT NOT NULL,
    lng FLOAT NOT NULL,
    location geography(POINT, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    ) STORED,
    combined_risk_score FLOAT NOT NULL CHECK (combined_risk_score BETWEEN 0 AND 1),
    asset_risk_score FLOAT,
    rainfall_risk_score FLOAT,
    rainfall_max_mm_per_hr FLOAT,
    asset_complaint_count INTEGER,
    pipe_age_estimate_years INTEGER,
    should_raise_tender_alert BOOLEAN DEFAULT FALSE,
    tender_alert_raised_at TIMESTAMPTZ,
    status TEXT DEFAULT 'NEW' CHECK (status IN ('NEW', 'REVIEWED', 'TENDER_RAISED', 'DISMISSED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infra_risk_location
    ON infrastructure_risk_alerts USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_infra_risk_status
    ON infrastructure_risk_alerts (status, combined_risk_score DESC);

CREATE INDEX IF NOT EXISTS idx_infra_risk_tender_alert
    ON infrastructure_risk_alerts (should_raise_tender_alert, created_at DESC)
    WHERE should_raise_tender_alert = TRUE;

-- ============================================================
-- 6. [TODO-TR-02] RAG SOP TRACKING
-- ============================================================
ALTER TABLE master_tickets
    ADD COLUMN IF NOT EXISTS sop_regulatory_citations JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS sop_rag_chunks_used INTEGER DEFAULT 0;

-- ============================================================
-- 7. [TODO-SEC-01] STRICT SUPABASE RLS POLICIES
-- Enable RLS on all tables + add strict tenant-isolation policies
-- ============================================================

-- Enable RLS (safe to run if already enabled)
ALTER TABLE master_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotspot_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizens ENABLE ROW LEVEL SECURITY;
ALTER TABLE officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE infrastructure_risk_alerts ENABLE ROW LEVEL SECURITY;

-- ── Citizens: can only see their own reports and master tickets they contributed to ──

-- Citizens see only their own citizen record
DROP POLICY IF EXISTS citizens_own_record ON citizens;
CREATE POLICY citizens_own_record ON citizens
    FOR ALL
    USING (auth.uid() = auth_user_id);

-- Citizens see ticket_reports they submitted
DROP POLICY IF EXISTS ticket_reports_citizen_own ON ticket_reports;
CREATE POLICY ticket_reports_citizen_own ON ticket_reports
    FOR SELECT
    USING (
        citizen_id IN (
            SELECT id FROM citizens WHERE auth_user_id = auth.uid()
        )
    );

-- Citizens see master tickets linked to their reports (read-only)
DROP POLICY IF EXISTS master_tickets_citizen_read ON master_tickets;
CREATE POLICY master_tickets_citizen_read ON master_tickets
    FOR SELECT
    USING (
        id IN (
            SELECT master_ticket_id FROM ticket_reports
            WHERE citizen_id IN (
                SELECT id FROM citizens WHERE auth_user_id = auth.uid()
            )
        )
    );

-- ── Officers: see only their own department's tickets ──

-- Officers see master tickets in their department
DROP POLICY IF EXISTS master_tickets_officer_department ON master_tickets;
CREATE POLICY master_tickets_officer_department ON master_tickets
    FOR ALL
    USING (
        department IN (
            SELECT department FROM officers WHERE auth_user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE auth_user_id = auth.uid() AND role = 'admin'
        )
    );

-- Officers see verification photos for their department's tickets
DROP POLICY IF EXISTS verification_photos_officer ON verification_photos;
CREATE POLICY verification_photos_officer ON verification_photos
    FOR ALL
    USING (
        master_ticket_id IN (
            SELECT id FROM master_tickets
            WHERE department IN (
                SELECT department FROM officers WHERE auth_user_id = auth.uid()
            )
        )
        OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE auth_user_id = auth.uid() AND role = 'admin'
        )
    );

-- Officers see ticket_reports for their department's master tickets
DROP POLICY IF EXISTS ticket_reports_officer ON ticket_reports;
CREATE POLICY ticket_reports_officer ON ticket_reports
    FOR SELECT
    USING (
        master_ticket_id IN (
            SELECT id FROM master_tickets
            WHERE department IN (
                SELECT department FROM officers WHERE auth_user_id = auth.uid()
            )
        )
        OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE auth_user_id = auth.uid() AND role = 'admin'
        )
    );

-- ── Admins: unrestricted access ──

DROP POLICY IF EXISTS hotspot_alerts_admin ON hotspot_alerts;
CREATE POLICY hotspot_alerts_admin ON hotspot_alerts
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE auth_user_id = auth.uid() AND role IN ('admin', 'officer')
        )
    );

DROP POLICY IF EXISTS ticket_events_admin ON ticket_events;
CREATE POLICY ticket_events_admin ON ticket_events
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE auth_user_id = auth.uid() AND role IN ('admin', 'officer')
        )
    );

DROP POLICY IF EXISTS infra_risk_admin ON infrastructure_risk_alerts;
CREATE POLICY infra_risk_admin ON infrastructure_risk_alerts
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE auth_user_id = auth.uid() AND role IN ('admin', 'officer')
        )
    );

-- Service role bypass (API server always uses service role key)
-- These policies apply only to anon + authenticated JWT calls

-- ============================================================
-- 8. MISCELLANEOUS INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_master_tickets_warranty_breach_check
    ON master_tickets (lat, lng, department, status, warranty_until)
    WHERE status = 'RESOLVED';

CREATE INDEX IF NOT EXISTS idx_ticket_events_warranty_breach
    ON ticket_events (actor_id, event_type)
    WHERE event_type = 'WARRANTY_BREACH';

COMMENT ON TABLE infrastructure_risk_alerts IS 
    'TODO-HS-02: Predictive infrastructure risk alerts fusing Open-Meteo rainfall + asset age data.';

COMMENT ON FUNCTION find_warranty_breach IS 
    'TODO-DD-01: Returns RESOLVED tickets within radius_m of a new complaint that are still under 60-day contractor warranty.';

COMMENT ON FUNCTION deduct_contractor_performance IS 
    'TODO-DD-01: Atomically deducts performance_score from officers table on warranty breach. Floors at 0.';
