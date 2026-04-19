-- Atomic feedback write: upserts feedback (if actionable) AND marks the cache
-- row seen in a single transaction. Replaces two sequential awaits in
-- app/api/feedback/route.ts that could leave the UI/cache out of sync on
-- partial failure.

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
  SET seen_at = NOW()
  WHERE user_id = p_user_id
    AND spotify_artist_id = p_artist_id;
END;
$$;

-- Atomic feedback soft-delete: clears feedback + resets seen_at on the cache
-- row in one transaction, matching the DELETE /api/feedback/[artistId] pattern.
CREATE OR REPLACE FUNCTION rpc_delete_feedback(
  p_user_id UUID,
  p_artist_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE feedback
  SET deleted_at = NOW()
  WHERE user_id = p_user_id
    AND spotify_artist_id = p_artist_id;

  UPDATE recommendation_cache
  SET seen_at = NULL
  WHERE user_id = p_user_id
    AND spotify_artist_id = p_artist_id;
END;
$$;
