-- Tracks when a user finished (or explicitly skipped) onboarding. Before this,
-- a user who tapped "Skip — show me anything" would bounce back into the
-- /onboarding route on every sign-in because /api/onboarding/check only
-- considered seed_artists + lastfm_username. Skipping is a valid choice — the
-- engine cold-starts from a curated seed list — so we record the timestamp
-- and treat presence as "user has been through onboarding."
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
