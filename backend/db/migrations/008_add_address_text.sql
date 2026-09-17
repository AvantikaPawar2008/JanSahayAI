-- CivicPulse Migration 008: Add human-readable address_text to master_tickets

ALTER TABLE master_tickets ADD COLUMN IF NOT EXISTS address_text TEXT;

-- Create index for fast text search on address
CREATE INDEX IF NOT EXISTS idx_master_tickets_address_text ON master_tickets (address_text);

-- Also add to hotspot_alerts if table exists for human-readable cluster location
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'hotspot_alerts') THEN
        ALTER TABLE hotspot_alerts ADD COLUMN IF NOT EXISTS address_text TEXT;
    END IF;
END $$;
