-- Harden RLS policies with WITH CHECK clauses (defense-in-depth).
--
-- Both tables are written almost exclusively via the service client (server
-- engine), which bypasses RLS entirely. But if a client session ever gains a
-- direct write path, the original `USING (...)`-only policies would allow
-- any authenticated user to INSERT/UPDATE rows with *any* user_id. Adding
-- WITH CHECK makes the constraint explicit for writes too.

DROP POLICY IF EXISTS "explore_cache: own rows" ON explore_cache;
CREATE POLICY "explore_cache: own rows" ON explore_cache
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_challenges: own rows" ON user_challenges;
CREATE POLICY "user_challenges: own rows" ON user_challenges
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
