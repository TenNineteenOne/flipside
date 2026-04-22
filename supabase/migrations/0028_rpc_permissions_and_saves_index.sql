-- Harden RPC permissions. These functions accept p_user_id as a parameter
-- and are only called from our Next.js API layer via the service-role key
-- (after NextAuth verifies the session). Revoke EXECUTE from PUBLIC / anon /
-- authenticated so a direct PostgREST call with a spoofed p_user_id cannot
-- modify another user's feedback, cache state, or challenge progress.
REVOKE EXECUTE ON FUNCTION rpc_record_feedback(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_record_feedback(UUID, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_record_feedback(UUID, TEXT, TEXT) FROM authenticated;

REVOKE EXECUTE ON FUNCTION rpc_delete_feedback(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_delete_feedback(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_delete_feedback(UUID, TEXT) FROM authenticated;

REVOKE EXECUTE ON FUNCTION rpc_increment_challenge_progress(UUID, DATE, TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_increment_challenge_progress(UUID, DATE, TEXT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_increment_challenge_progress(UUID, DATE, TEXT, INT) FROM authenticated;

-- Missing per-user index on saves. Every saves lookup filters by user_id.
CREATE INDEX IF NOT EXISTS idx_saves_user_id ON saves(user_id);

-- artist_external_links is a global cache populated by the service role.
-- Enable RLS with a read-all policy so direct client reads remain fine while
-- writes are restricted to the service role (which bypasses RLS).
ALTER TABLE IF EXISTS artist_external_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "artist_external_links: read-all" ON artist_external_links;
CREATE POLICY "artist_external_links: read-all" ON artist_external_links
  FOR SELECT USING (true);
