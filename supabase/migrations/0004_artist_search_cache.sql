-- Global cache of artist-name → Spotify-data lookups.
-- Shared across all users so the first user to see a name pays the search cost once.
create table if not exists artist_search_cache (
  name_lower text primary key,
  spotify_artist_id text not null,
  artist_name text not null,
  artist_data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_artist_search_cache_spotify_id
  on artist_search_cache(spotify_artist_id);
