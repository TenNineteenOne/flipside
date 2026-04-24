-- rpc_clear_dismiss: Unblock a permanently-dismissed artist so they can
-- resurface in Explore and Feed again.
--
-- The "Dismiss" button on a card writes skip_at (and seen_at) via
-- rpc_record_feedback with signal='skip'. Migration 0033 intentionally does
-- NOT insert a feedback row for skip, so the existing rpc_delete_feedback is
-- a no-op for dismissed items. This RPC clears both columns on the
-- recommendation_cache row so the artist is fully eligible again (no skip_at
-- filter, no 7-day seen_at cooldown).
--
-- Idempotent: UPDATE on a non-existent row is a no-op.

CREATE OR REPLACE FUNCTION rpc_clear_dismiss(
  p_user_id UUID,
  p_artist_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE recommendation_cache
  SET skip_at = NULL,
      seen_at = NULL
  WHERE user_id = p_user_id
    AND spotify_artist_id = p_artist_id;
END;
$$;

-- Permissions mirror 0033_feedback_rpc_intent_fixes.sql — server-only via
-- service role; app code calls through the service client.
REVOKE EXECUTE ON FUNCTION rpc_clear_dismiss(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_clear_dismiss(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_clear_dismiss(UUID, TEXT) FROM authenticated;
