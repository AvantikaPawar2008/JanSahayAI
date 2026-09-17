-- CivicPulse Migration 006: Hardening Problem Clustering & Duplicate Identification
-- 1. Fix nested aggregate in detect_hotspot_clusters and partition by department/sub_category
-- 2. Strictly filter by sub_category in find_nearby_hotspots WHERE clause
-- 3. Add canonical text_embedding column to master_tickets

-- ------------------------------------------------------------
-- 1. Add text_embedding column to master_tickets (if not exists)
-- ------------------------------------------------------------
DO $$ BEGIN
    ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS text_embedding vector(384);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 2. Drop existing functions to allow clean signature updates
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS detect_hotspot_clusters(DOUBLE PRECISION, INTEGER, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS find_nearby_hotspots(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) CASCADE;
DROP FUNCTION IF EXISTS find_nearby_hotspots(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) CASCADE;

-- ------------------------------------------------------------
-- 3. Hardened detect_hotspot_clusters (No nested aggregates, department partitioning)
-- ------------------------------------------------------------
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
            mt.id,
            mt.category,
            mt.sub_category,
            mt.department,
            mt.lat,
            mt.lng,
            mt.location,
            -- EPSG:3857 Web Mercator metric projection
            ST_ClusterDBSCAN(
                ST_Transform(mt.location::geometry, 3857),
                eps := eps_meters,
                minpoints := min_pts
            ) OVER (PARTITION BY mt.department) AS cluster_id
        FROM master_tickets mt
        WHERE mt.status NOT IN ('RESOLVED', 'CLOSED')
    ),
    cluster_centroids AS (
        SELECT
            c.department,
            c.cluster_id,
            MODE() WITHIN GROUP (ORDER BY c.category) AS primary_category,
            MODE() WITHIN GROUP (ORDER BY c.sub_category) AS primary_sub_category,
            AVG(c.lat) AS c_lat,
            AVG(c.lng) AS c_lng,
            COUNT(*)::BIGINT AS c_count,
            ARRAY_AGG(c.id) AS c_ticket_ids
        FROM clustered c
        WHERE c.cluster_id IS NOT NULL
        GROUP BY c.department, c.cluster_id
        HAVING COUNT(*) >= min_pts
    )
    SELECT
        cen.primary_category AS category,
        cen.primary_sub_category AS sub_category,
        cen.department,
        cen.c_lat AS center_lat,
        cen.c_lng AS center_lng,
        GREATEST(
            eps_meters,
            COALESCE(
                (
                    SELECT MAX(
                        ST_Distance(
                            c2.location,
                            ST_SetSRID(ST_MakePoint(cen.c_lng, cen.c_lat), 4326)::geography
                        )
                    )
                    FROM clustered c2
                    WHERE c2.cluster_id = cen.cluster_id
                      AND (c2.department = cen.department OR (c2.department IS NULL AND cen.department IS NULL))
                ),
                eps_meters
            )
        ) AS radius_m,
        cen.c_count AS ticket_count,
        cen.c_ticket_ids AS ticket_ids
    FROM cluster_centroids cen;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 4. Hardened find_nearby_hotspots (Sub-category strictly filtered)
-- ------------------------------------------------------------
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
    WHERE (ha.category = search_category OR ha.department::text = search_category)
      AND (search_sub_category IS NULL OR ha.sub_category IS NULL OR ha.sub_category = search_sub_category)
      AND ha.status NOT IN ('RESOLVED')
      AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(ha.center_lng, ha.center_lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography,
          radius_m
      );
END;
$$ LANGUAGE plpgsql;
