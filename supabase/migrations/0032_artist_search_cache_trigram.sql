-- Artist search hits artist_search_cache with ILIKE '<prefix>%' both from
-- the onboarding/seed-gen search flow (when live Spotify is rate-limited and
-- we fall back to cache in app/api/onboarding/search/route.ts) and from any
-- other prefix lookup. The table's PK on name_lower uses the default text
-- opclass, which does NOT serve ILIKE pattern queries — every search has to
-- sequential-scan the cache. Add a trigram GIN index so ILIKE/LIKE prefix
-- and substring queries can use an index.
--
-- pg_trgm is a stock Postgres extension; Supabase projects have it in the
-- extensions schema by default, so the CREATE EXTENSION is a no-op on
-- hosted projects but is included for local dev parity.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_artist_search_cache_name_trgm
  ON artist_search_cache
  USING gin (name_lower gin_trgm_ops);
