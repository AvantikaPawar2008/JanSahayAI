-- Migration 009: Before-photo tracking, sharpness scoring, verification method
-- Run in Supabase SQL Editor

-- ============================================================
-- 1. image_sharpness_score on ticket_reports
--    Higher = sharper image (Laplacian variance, computed by backend at upload time)
-- ============================================================
ALTER TABLE ticket_reports ADD COLUMN IF NOT EXISTS image_sharpness_score DOUBLE PRECISION;

-- ============================================================
-- 2. verification_method on verification_photos
--    Tracks which confidence tier was used so officers can see context
--    Values: 'before_after_comparison' | 'single_photo_completion'
-- ============================================================
ALTER TABLE verification_photos ADD COLUMN IF NOT EXISTS verification_method TEXT DEFAULT 'before_after_comparison';

-- ============================================================
-- 3. has_before_photo on master_tickets
--    Cached flag so officer/admin UI can branch without recomputing on every read
-- ============================================================
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS has_before_photo BOOLEAN DEFAULT false;

-- ============================================================
-- 4. source_report_id FK on verification_photos
--    Lets sharpness comparison look up the originating ticket_report's score
--    to decide whether a new duplicate report's photo should replace an existing before-photo
-- ============================================================
ALTER TABLE verification_photos ADD COLUMN IF NOT EXISTS source_report_id UUID REFERENCES ticket_reports(id);

-- Index for fast FK lookups
CREATE INDEX IF NOT EXISTS idx_verification_photos_source_report_id
    ON verification_photos (source_report_id);

-- Index for fast has_before_photo queries
CREATE INDEX IF NOT EXISTS idx_master_tickets_has_before_photo
    ON master_tickets (has_before_photo);
