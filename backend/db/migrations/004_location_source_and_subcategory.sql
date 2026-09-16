-- CivicPulse Migration 004: Location Source Tracking and Fine-Grained Sub-Category Triage

-- 1. Add location_source column to ticket_reports table ('gps' or 'manual')
ALTER TABLE ticket_reports ADD COLUMN IF NOT EXISTS location_source TEXT DEFAULT 'gps';

-- 2. Add sub_category column to master_tickets table
ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS sub_category TEXT;

-- 3. Add index on sub_category for fast clustering queries
CREATE INDEX IF NOT EXISTS idx_master_tickets_sub_category ON master_tickets (sub_category);
