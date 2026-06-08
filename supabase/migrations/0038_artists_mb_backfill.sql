-- 0038 — MusicBrainz backfill queue cursor (#159).
--
-- Stage 2 / #157 mints artists by NAME with no spotify_id (Spotify-free
-- generation). The #159 worker (app/api/cron/mb-backfill/route.ts) lazily
-- backfills spotify_id / mbid / apple_id / deezer_id for those name-only artists
-- via MusicBrainz (url-rels), WITHOUT calling the Spotify API.
--
-- This adds the queue cursor the worker scans on:
--   * mbid_attempted_at — when we last tried to resolve this artist via MB.
--     NULL = never attempted. The worker always stamps it (even on no-match) so
--     a name MB can't resolve isn't re-hammered every run; a refresh interval
--     (14d, enforced in the worker query) lets MB catch up over time.
--   * a partial index over the queue predicate (spotify_id IS NULL) ordered
--     nulls-first so never-attempted artists sort to the front of the scan.
--
-- Re-runnable (if-not-exists guards throughout).

alter table artists add column if not exists mbid_attempted_at timestamptz;

-- Worker queue scan: only artists still missing a spotify_id are candidates;
-- nulls-first puts never-attempted artists ahead of previously-attempted ones.
-- (The worker's freshness filter — attempted_at < now() - 14d — is applied in
-- the query; this index keeps the candidate scan cheap as the roster grows.)
create index if not exists idx_artists_mb_backfill_queue
  on artists (mbid_attempted_at nulls first)
  where spotify_id is null;
