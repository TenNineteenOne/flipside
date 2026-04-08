-- Global cache of artist-id → track list lookups, sourced from iTunes (or
-- Spotify as a fallback). Shared across all users because track lists are
-- public data. TTL is enforced in app code via fetched_at.
create table if not exists artist_tracks_cache (
  spotify_artist_id text primary key,
  tracks jsonb not null,
  source text not null,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_artist_tracks_cache_fetched_at
  on artist_tracks_cache(fetched_at);
