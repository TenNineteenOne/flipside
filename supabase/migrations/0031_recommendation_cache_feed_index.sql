-- Hot feed query:
--   SELECT ... FROM recommendation_cache
--    WHERE user_id = ? AND seen_at IS NULL AND expires_at > now()
--    ORDER BY score DESC
--    LIMIT 20
-- Existing (user_id, expires_at) full index forces Postgres to still scan
-- every cache row for the user and filter seen_at = NULL in memory, then
-- re-sort by score. Partial index + score ordering removes both hops.
CREATE INDEX IF NOT EXISTS idx_recommendation_cache_feed_hot
  ON recommendation_cache (user_id, score DESC, expires_at DESC)
  WHERE seen_at IS NULL;

-- Complementary partial index for feedback table. The thumbs-up lookup in
-- gatherSeedContext filters WHERE deleted_at IS NULL; the existing
-- (user_id, spotify_artist_id) b-tree doesn't help the signal filter.
CREATE INDEX IF NOT EXISTS idx_feedback_user_signal_live
  ON feedback (user_id, signal)
  WHERE deleted_at IS NULL;
