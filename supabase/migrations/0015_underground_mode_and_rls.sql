-- Add underground_mode toggle to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS underground_mode BOOLEAN NOT NULL DEFAULT false;

-- Enable RLS on tables that were missing it
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_search_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_tracks_cache ENABLE ROW LEVEL SECURITY;

-- login_attempts: only service role can read/write (no public access)
-- No policies = deny all for anon/authenticated, service role bypasses RLS

-- artist_search_cache: allow reads for all authenticated, writes for service role only
CREATE POLICY "Authenticated users can read search cache"
  ON artist_search_cache FOR SELECT
  TO authenticated
  USING (true);

-- artist_tracks_cache: allow reads for all authenticated, writes for service role only
CREATE POLICY "Authenticated users can read tracks cache"
  ON artist_tracks_cache FOR SELECT
  TO authenticated
  USING (true);
