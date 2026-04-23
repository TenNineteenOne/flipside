-- Explore cache: one row per (user, rail). Rails cache 24h. Invalidated on
-- thumbs-up / thumbs-down / seed change / selected_genres change / Adventurous
-- toggle (by deleting rows for the user). Cached empty rails are still cached
-- so we don't re-fetch thrash on users who have nothing to show.
CREATE TABLE IF NOT EXISTS explore_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rail_key TEXT NOT NULL,
  artist_ids TEXT[] NOT NULL DEFAULT '{}',
  why JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, rail_key)
);

-- Primary lookup index: fetching all rails for a user on /explore page load.
CREATE INDEX IF NOT EXISTS idx_explore_cache_user_expires
  ON explore_cache(user_id, expires_at);

-- RLS: users can only see their own rail cache rows. Service role (server-side
-- engine) still has full access via the service key.
ALTER TABLE explore_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "explore_cache: own rows" ON explore_cache;
CREATE POLICY "explore_cache: own rows" ON explore_cache FOR ALL
  USING (auth.uid() = user_id);
