-- Rewrite RLS policies to key on users.id = auth.uid() instead of
-- users.spotify_id = auth.uid()::text. Since 0011 made spotify_id nullable,
-- the old policies silently fail for username-only accounts. All routes use
-- the service client today (which bypasses RLS), so this is defense-in-depth
-- for any future anon-client usage.
--
-- The dropped policies for groups, group_members, and group_activity are
-- already moot — those tables were dropped in 0010_remove_social_features.

-- users
DROP POLICY IF EXISTS "users: own row" ON users;
CREATE POLICY "users: own row" ON users FOR ALL
  USING (auth.uid() = id);

-- seed_artists
DROP POLICY IF EXISTS "seed_artists: own rows" ON seed_artists;
CREATE POLICY "seed_artists: own rows" ON seed_artists FOR ALL
  USING (auth.uid() = user_id);

-- listened_artists
DROP POLICY IF EXISTS "listened_artists: own rows" ON listened_artists;
CREATE POLICY "listened_artists: own rows" ON listened_artists FOR ALL
  USING (auth.uid() = user_id);

-- recommendation_cache
DROP POLICY IF EXISTS "recommendation_cache: own rows" ON recommendation_cache;
CREATE POLICY "recommendation_cache: own rows" ON recommendation_cache FOR ALL
  USING (auth.uid() = user_id);

-- feedback
DROP POLICY IF EXISTS "feedback: own rows" ON feedback;
CREATE POLICY "feedback: own rows" ON feedback FOR ALL
  USING (auth.uid() = user_id);

-- saves
DROP POLICY IF EXISTS "saves: own rows" ON saves;
CREATE POLICY "saves: own rows" ON saves FOR ALL
  USING (auth.uid() = user_id);
