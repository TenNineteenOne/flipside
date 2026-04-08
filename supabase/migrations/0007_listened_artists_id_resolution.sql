-- Add id_resolution_attempted_at to listened_artists.
-- Tracks when we last tried to resolve a Last.fm artist name to a Spotify ID
-- so failed lookups are retried at most once per 7 days rather than on every sync.
alter table listened_artists
  add column if not exists id_resolution_attempted_at timestamptz;
