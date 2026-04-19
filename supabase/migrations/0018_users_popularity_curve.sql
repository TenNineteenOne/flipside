-- Add per-user popularity curve steepness.
-- Controls the base `k` of the scoring curve `k^popularity`.
-- Range 0.90 – 1.00. Default 0.95 matches the previously hardcoded value.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS popularity_curve NUMERIC(4,3) NOT NULL DEFAULT 0.95
  CHECK (popularity_curve >= 0.900 AND popularity_curve <= 1.000);
