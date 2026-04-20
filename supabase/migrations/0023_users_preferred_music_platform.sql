-- Per-user preferred streaming platform for "Open in …" / share actions.
-- v1 supports Spotify, Apple Music, YouTube Music. The CHECK constraint is
-- extended when we add Tidal / Deezer / Amazon Music later.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_music_platform TEXT NOT NULL DEFAULT 'spotify';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_preferred_music_platform_check;

ALTER TABLE users
  ADD CONSTRAINT users_preferred_music_platform_check
  CHECK (preferred_music_platform IN ('spotify', 'apple_music', 'youtube_music'));

-- Cache for resolved direct URLs (currently only Apple Music via iTunes
-- Search API). YouTube Music uses a search URL and needs no cache.
CREATE TABLE IF NOT EXISTS artist_external_links (
  spotify_artist_id TEXT PRIMARY KEY,
  apple_music_url   TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
