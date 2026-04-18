-- Add cooldown timestamps for expensive endpoints
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_generated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_accumulated_at TIMESTAMPTZ;
