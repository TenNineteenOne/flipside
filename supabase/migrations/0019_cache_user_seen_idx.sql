-- Composite index to speed up two hot queries on recommendation_cache:
--   1. Stats page: count seen artists per user (seen_at IS NOT NULL)
--   2. Engine cooldown check: look up (user_id, spotify_artist_id) and read seen_at
-- Existing index is (user_id, expires_at); neither query uses expires_at.

CREATE INDEX IF NOT EXISTS idx_recommendation_cache_user_seen
  ON recommendation_cache(user_id, seen_at);
