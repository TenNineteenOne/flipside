-- Two intent fixes surfaced in the post-release bug sweep:
--
-- 1. rpc_record_feedback used to only credit the weekly challenge when the
--    feedback row was genuinely new (v_inserted = true). That meant a user
--    who thumbs-down'd an artist and later changed their mind to thumbs-up
--    hit the ON CONFLICT UPDATE path and got no challenge credit for what
--    is a real fresh "like" action. Fix: track the row's previous signal
--    before the upsert and credit any transition INTO thumbs_up from a
--    non-thumbs_up state (new row, or flip from thumbs_down).
--
-- 2. rpc_delete_feedback used to reset recommendation_cache.seen_at = NULL
--    on un-like, which made un-liked cards re-surface on the next feed load.
--    The agreed product intent (per the thumbs-up grill) is session-only
--    undo: the card was already processed for the day, un-like should not
--    summon it back. Fix: leave seen_at untouched.
--
-- Both RPCs are re-created atomically so the deploy is either fully applied
-- or fully unapplied.

CREATE OR REPLACE FUNCTION rpc_record_feedback(
  p_user_id UUID,
  p_artist_id TEXT,
  p_signal TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous_signal TEXT;
  v_was_deleted BOOLEAN := FALSE;
  v_week_start DATE;
BEGIN
  IF p_signal NOT IN ('thumbs_up', 'thumbs_down', 'skip') THEN
    RAISE EXCEPTION 'invalid signal: %', p_signal;
  END IF;

  IF p_signal <> 'skip' THEN
    -- Snapshot the previous live signal (if any) before the upsert so we can
    -- decide whether this is a transition into thumbs_up worth crediting.
    -- A soft-deleted row counts as "no previous live signal" — resurrecting
    -- it with thumbs_up should credit the challenge.
    SELECT signal, deleted_at IS NOT NULL
      INTO v_previous_signal, v_was_deleted
      FROM feedback
      WHERE user_id = p_user_id
        AND spotify_artist_id = p_artist_id
      LIMIT 1;

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

  -- Credit the challenge when transitioning INTO a live thumbs_up from
  -- anything else (no row yet, soft-deleted row, thumbs_down, or skip).
  -- Still guards against double-counting a user who toggles thumbs_up
  -- repeatedly (previous was thumbs_up and not deleted → no credit).
  IF p_signal = 'thumbs_up' AND (
    v_previous_signal IS NULL
    OR v_was_deleted
    OR v_previous_signal <> 'thumbs_up'
  ) THEN
    v_week_start := date_trunc('week', (NOW() AT TIME ZONE 'UTC'))::DATE;
    PERFORM rpc_increment_challenge_progress(
      p_user_id,
      v_week_start,
      p_signal,
      1
    );
  END IF;
END;
$$;

-- rpc_delete_feedback: soft-delete the feedback row but leave seen_at alone.
-- The card was already seen / processed; un-liking doesn't un-process it.
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

  -- Intentionally does NOT touch recommendation_cache.seen_at.
  -- Session-only undo: the user already dealt with this card; it stays
  -- out of future feed pulls regardless of whether they later changed
  -- their mind within the session.
END;
$$;

-- Permissions mirror 0028_rpc_permissions_and_saves_index.sql.
REVOKE EXECUTE ON FUNCTION rpc_record_feedback(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_record_feedback(UUID, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_record_feedback(UUID, TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION rpc_delete_feedback(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_delete_feedback(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_delete_feedback(UUID, TEXT) FROM authenticated;
