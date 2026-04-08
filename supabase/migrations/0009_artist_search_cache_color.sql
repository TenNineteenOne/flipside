-- Add artist_color column to artist_search_cache.
-- Nullable: populated lazily at recommendation-generation time by the
-- colour-extraction pipeline. NULL means extraction has not yet run for
-- this artist (client should use the #8b5cf6 fallback).
ALTER TABLE artist_search_cache
  ADD COLUMN IF NOT EXISTS artist_color TEXT;
