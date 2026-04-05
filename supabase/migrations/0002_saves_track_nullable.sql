-- Make spotify_track_id nullable (artist saves no longer require a track)
-- and add unique constraint so upsert onConflict works.

-- Remove duplicate rows first (keep newest) to allow adding unique constraint
delete from saves a using saves b
  where a.created_at < b.created_at
  and a.user_id = b.user_id
  and a.spotify_artist_id = b.spotify_artist_id;

alter table saves alter column spotify_track_id drop not null;

alter table saves add constraint saves_user_artist_unique unique (user_id, spotify_artist_id);
