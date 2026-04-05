-- 1. Add artist_name to saves table so the saved page can show names
--    even after recommendation_cache entries have been evicted.
alter table saves add column if not exists artist_name text;

-- 2. Deduplicate group_activity — keep newest row per (user, group, artist)
--    so the unique constraint below can be added without conflict errors.
delete from group_activity a
using group_activity b
where a.created_at < b.created_at
  and a.user_id = b.user_id
  and a.group_id = b.group_id
  and a.spotify_artist_id = b.spotify_artist_id;

-- 3. Add unique constraint so upsert onConflict works correctly.
--    Without this, upsert behaves like insert and duplicates accumulate.
alter table group_activity
  add constraint group_activity_user_group_artist_unique
  unique (user_id, group_id, spotify_artist_id);
