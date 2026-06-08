-- 0037 — Slice 2: re-key the external cache tables to artist_id (PK swap).
--
-- artist_tracks_cache + artist_external_links are CROSS-USER CACHES (disposable,
-- TTL'd). 0036 already added artist_id (uuid, unique, FK→artists, fully
-- backfilled). This makes artist_id the PRIMARY KEY and relaxes spotify_artist_id
-- to nullable (kept for the later drop-old migration). The tracks/open/resolve-
-- track routes re-key to artist_id (resolve-track recovers spotify_id from
-- `artists` for its Spotify API call).
--
-- Low-risk: these are disposable caches; any brief old-route write breakage during
-- the deploy gap (old onConflict:'spotify_artist_id' no longer has a unique) just
-- means a cache miss that self-heals once the new route code is live. Reads of
-- existing rows keep working throughout. Re-runnable (drop-if-exists guards).

-- Defensive backfill — 0036 populated these; catch anything written since.
update artist_tracks_cache   t set artist_id = a.id from artists a where a.spotify_id = t.spotify_artist_id and t.artist_id is null;
update artist_external_links t set artist_id = a.id from artists a where a.spotify_id = t.spotify_artist_id and t.artist_id is null;

do $$
begin
  if exists (select 1 from artist_tracks_cache   where artist_id is null) then raise exception '0037: artist_tracks_cache has unresolved artist_id rows'; end if;
  if exists (select 1 from artist_external_links where artist_id is null) then raise exception '0037: artist_external_links has unresolved artist_id rows'; end if;
end $$;

-- artist_tracks_cache: artist_id → NOT NULL + PRIMARY KEY; spotify_artist_id → nullable.
alter table artist_tracks_cache   alter column artist_id set not null;
alter table artist_tracks_cache   drop constraint if exists artist_tracks_cache_pkey;
alter table artist_tracks_cache   drop constraint if exists artist_tracks_cache_artist_id_key;
alter table artist_tracks_cache   add  constraint artist_tracks_cache_pkey primary key (artist_id);
alter table artist_tracks_cache   alter column spotify_artist_id drop not null;

-- artist_external_links: same.
alter table artist_external_links alter column artist_id set not null;
alter table artist_external_links drop constraint if exists artist_external_links_pkey;
alter table artist_external_links drop constraint if exists artist_external_links_artist_id_key;
alter table artist_external_links add  constraint artist_external_links_pkey primary key (artist_id);
alter table artist_external_links alter column spotify_artist_id drop not null;
