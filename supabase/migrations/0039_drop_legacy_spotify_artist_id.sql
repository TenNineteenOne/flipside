-- 0039 — drop-old (Migration B / final): remove the legacy spotify_artist_id identity.
--
-- ⚠️ APPLY ONLY AFTER the new app code is deployed + verified (§H1 two-migration
-- split). By now the app speaks `artist_id` everywhere and calls the `_v2` UUID
-- RPCs; the old spotify_artist_id columns / TEXT RPCs / artist_search_cache are
-- dead. This migration is NOT reversible — it's the cleanup, run last.
--
-- `drop column … cascade` also removes the dependent old objects: the
-- unique(user_id, spotify_artist_id) constraints, the spotify_artist_id indexes,
-- and the old `…_unresolved_idx` partial index (WHERE spotify_artist_id IS NULL).
-- The new artist_id uniques/PKs + the artist_id-based unresolved index remain.

-- Per-user identity tables.
alter table recommendation_cache  drop column if exists spotify_artist_id cascade;
alter table feedback              drop column if exists spotify_artist_id cascade;
alter table saves                 drop column if exists spotify_artist_id cascade;
alter table seed_artists          drop column if exists spotify_artist_id cascade;
alter table listened_artists      drop column if exists spotify_artist_id cascade;

-- External caches (artist_id became the PK in 0037; spotify_artist_id was kept nullable for the gap).
alter table artist_tracks_cache   drop column if exists spotify_artist_id cascade;
alter table artist_external_links drop column if exists spotify_artist_id cascade;

-- The folded-away search cache — its metadata now lives in `artists`.
drop table if exists artist_search_cache;

-- The old TEXT RPC overloads — the app calls the _v2 UUID versions (#157).
-- (We keep the _v2 names; re-creating clean base names is a deferred cosmetic cleanup.)
drop function if exists rpc_record_feedback(uuid, text, text);
drop function if exists rpc_delete_feedback(uuid, text);
drop function if exists rpc_clear_dismiss(uuid, text);
