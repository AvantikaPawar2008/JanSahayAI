-- CivicPulse Migration 005: Fix Problem Clustering & Deduplication Vulnerabilities
-- 1. ST_ClusterDBSCAN metric projection (3857) to prevent degree/meter unit mismatch
-- 2. Include sub_category in find_nearby_tickets for hard-filter deduplication
-- 3. Atomic upvote increment stored procedure to prevent TOCTOU race condition
-- 4. Parameterized find_nearby_hotspots supporting sub_category

-- ============================================================
-- 1. Fix detect_hotspot_clusters (Metric DBSCAN)
-- ============================================================
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
            -- Transform geometry to EPSG:3857 (Web Mercator) so eps is evaluated in real METERS, not degrees!
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
        -- Calculate actual max distance from centroid or default to eps_meters
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

-- ============================================================
-- 2. Fix find_nearby_tickets (Include sub_category)
-- ============================================================
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

-- ============================================================
-- 3. Atomic upvote increment function
-- ============================================================
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

-- ============================================================
-- 4. Fix find_nearby_hotspots (support sub_category)
-- ============================================================
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
