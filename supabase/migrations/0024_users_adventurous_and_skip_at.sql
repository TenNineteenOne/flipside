-- Adventurous mode: settings-level toggle that broadens For You (adjacent-
-- genre bleed, softer mainstream-seed penalty) and amplifies Explore rails.
-- Default OFF; users opt in from Settings.
ALTER TABLE users ADD COLUMN IF NOT EXISTS adventurous BOOLEAN NOT NULL DEFAULT FALSE;

-- skip_at: records when a user skipped a recommendation. Engine treats a
-- skip as a 30-day cooldown (vs 7 days for plain seen_at) so the artist
-- doesn't re-surface in the next few generations.
ALTER TABLE recommendation_cache ADD COLUMN IF NOT EXISTS skip_at TIMESTAMPTZ;

-- Partial index supports the cooldown lookup at generation time without
-- bloating the index with the common NULL case.
CREATE INDEX IF NOT EXISTS idx_recommendation_cache_user_skip_at
  ON recommendation_cache(user_id, skip_at)
  WHERE skip_at IS NOT NULL;

-- Re-create rpc_record_feedback so 'skip' stamps skip_at alongside seen_at.
-- Previous version (0020) only updated seen_at for skip, leaving the 30-day
-- cooldown with nowhere to anchor.
CREATE OR REPLACE FUNCTION rpc_record_feedback(
  p_user_id UUID,
  p_artist_id TEXT,
  p_signal TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_signal NOT IN ('thumbs_up', 'thumbs_down', 'skip') THEN
    RAISE EXCEPTION 'invalid signal: %', p_signal;
  END IF;

  IF p_signal <> 'skip' THEN
    INSERT INTO feedback (user_id, spotify_artist_id, signal, deleted_at)
    VALUES (p_user_id, p_artist_id, p_signal, NULL)
    ON CONFLICT (user_id, spotify_artist_id)
    DO UPDATE SET
      signal = EXCLUDED.signal,
      deleted_at = NULL;
  END IF;

  UPDATE recommendation_cache
  SET
    seen_at = NOW(),
    skip_at = CASE WHEN p_signal = 'skip' THEN NOW() ELSE skip_at END
  WHERE user_id = p_user_id
    AND spotify_artist_id = p_artist_id;
END;
$$;
