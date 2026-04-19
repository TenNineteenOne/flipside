-- stats.fm integration: add public username column alongside lastfm_username
-- and allow 'statsfm' as a source in listened_artists.
alter table users add column statsfm_username text;

-- Per-source cooldown columns (replaces single last_accumulated_at for per-source sync UX).
-- The legacy column stays populated as a "most recent any-source sync" for backwards compat.
alter table users add column last_accumulated_lastfm_at timestamptz;
alter table users add column last_accumulated_statsfm_at timestamptz;

alter table listened_artists drop constraint listened_artists_source_check;
alter table listened_artists add constraint listened_artists_source_check
  check (source in ('spotify_recent', 'spotify_top', 'lastfm', 'statsfm'));

-- Prevent duplicate unresolved name-only rows across sources (Last.fm + stats.fm
-- both feeding the same artist name concurrently would otherwise create dupes).
create unique index if not exists listened_artists_user_name_unresolved_idx
  on listened_artists (user_id, lastfm_artist_name)
  where lastfm_artist_name is not null and spotify_artist_id is null;
