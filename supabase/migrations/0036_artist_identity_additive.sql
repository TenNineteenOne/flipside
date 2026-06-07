-- 0036 — Surrogate-UUID artist identity: ADDITIVE migration (Migration A).
--
-- Refs: docs/adr/0001-surrogate-uuid-artist-identity.md,
--       docs/spotify-removal-checklist.md §A + §H1 ("Resolved decisions").
--
-- ADDITIVE ONLY. This migration is applied BEFORE the app code deploys, so the
-- OLD code (which writes spotify_artist_id) must keep working during the ~2-4min
-- deploy gap, AND the NEW code (which writes artist_id) must work the moment it
-- lands. Therefore:
--   * `artist_id` columns are added NULLABLE (old-code writes leave them null).
--   * `spotify_artist_id` is made NULLABLE (new-code writes leave it null).
--   * NEW unique(user_id, artist_id) is added ALONGSIDE the old unique — each
--     constraint dedups its own non-null rows.
--   * old spotify_artist_id columns / old constraints / old TEXT RPC overloads
--     are KEPT ALIVE. PK surgery, NOT NULL, and all drops happen in 0037.
-- Rollback during the gap = revert the Vercel deploy (old code still works).
-- `DELETE FROM explore_cache` is NOT reversible (self-heals on 24h regen).
--
-- The whole file runs as one implicit transaction under scripts/_replay.ts; a
-- guard RAISE EXCEPTION aborts the entire migration. Re-runnable on rehearsal
-- (if-not-exists / on-conflict / drop-if-exists guards throughout).

-- ============================================================================
-- 1. Canonical `artists` table
-- ============================================================================
create table if not exists artists (
  id          uuid primary key default gen_random_uuid(),
  spotify_id  text unique,                 -- attribute, not identity; unique dedup key
  mbid        text unique,                 -- validated-MusicBrainz-only (never raw Last.fm)
  apple_id    text,
  deezer_id   text,
  name        text not null,
  name_lower  text not null,               -- NON-unique (homonyms coexist — ADR-0001 / §H3)
  genres      text[] not null default '{}',
  popularity  int,
  image_url   text,
  artist_color text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table artists enable row level security;
-- authenticated read; service-role writes bypass RLS. No insert/update/delete policy.
drop policy if exists "artists: authenticated read" on artists;
create policy "artists: authenticated read" on artists for select to authenticated using (true);

-- Data-API grants (ADR-0001 "harden"): explicit, defense-in-depth on this shared
-- cross-user table. Supabase's default privileges auto-grant ALL to anon+authenticated;
-- revoke that and grant only SELECT to authenticated. RLS is the primary control, this
-- is the second lock, and being explicit survives the upcoming Supabase default-grant flip.
-- service_role keeps full access (bypasses RLS) for server writes.
revoke all on table artists from anon;
revoke all on table artists from authenticated;
grant select on table artists to authenticated;

-- Equality lookups (name-cache .in('name_lower',…)) + ILIKE prefix search (onboarding).
create index if not exists idx_artists_name_lower on artists (name_lower);
create index if not exists idx_artists_name_trgm  on artists using gin (name_lower gin_trgm_ops);

-- ============================================================================
-- 2. Backfill `artists` from artist_search_cache (first-seen wins on spotify_id)
-- ============================================================================
-- ⚠️ artist_search_cache.name_lower is the SEARCH QUERY key (its PK), NOT
-- lower(artist_name) — a search for "drake & future" that resolved to one artist
-- stored name_lower='drake & future'. The canonical roster name must be
-- lower(artist_name), or name lookups (the resolver doorway) silently miss the
-- artist and mint a phantom UUID. Also: one spotify_id can appear under many query
-- rows (collabs/aliases), so DISTINCT ON + ORDER BY makes the winner deterministic
-- (prefer the exact-canonical row, then shortest query) instead of heap-scan order.
insert into artists (spotify_id, name, name_lower, genres, popularity, image_url, artist_color)
select distinct on (c.spotify_artist_id)
  c.spotify_artist_id,
  c.artist_name,
  lower(c.artist_name),
  case when jsonb_typeof(c.artist_data->'genres') = 'array'
       then (select coalesce(array_agg(value), '{}') from jsonb_array_elements_text(c.artist_data->'genres'))
       else '{}' end,
  nullif(c.artist_data->>'popularity', '')::int,
  c.artist_data->>'imageUrl',
  c.artist_color
from artist_search_cache c
order by c.spotify_artist_id, (lower(c.artist_name) = c.name_lower) desc, length(c.name_lower) asc
on conflict (spotify_id) do nothing;

-- 2b. Orphan backfill: spotify ids referenced by per-user / cache tables that
--     never had an artist_search_cache row. Placeholder name = spotify_id;
--     the #159 MusicBrainz worker enriches these later.
insert into artists (spotify_id, name, name_lower)
select s.sid, s.sid, lower(s.sid)
from (
  select spotify_artist_id as sid from recommendation_cache
  union select spotify_artist_id from feedback
  union select spotify_artist_id from saves
  union select spotify_artist_id from seed_artists
  union select spotify_artist_id from listened_artists where spotify_artist_id is not null
  union select spotify_artist_id from artist_tracks_cache
  union select spotify_artist_id from artist_external_links
) s
where s.sid is not null
on conflict (spotify_id) do nothing;

do $$
declare n int;
begin
  select count(*) into n from artists where name = spotify_id;
  raise notice '0036: % orphan placeholder artists (name = spotify_id)', n;
end $$;

-- ============================================================================
-- 3. Add NULLABLE artist_id (FK → artists, ON DELETE RESTRICT) + populate
-- ============================================================================
alter table recommendation_cache add column if not exists artist_id uuid references artists(id) on delete restrict;
alter table feedback             add column if not exists artist_id uuid references artists(id) on delete restrict;
alter table saves                add column if not exists artist_id uuid references artists(id) on delete restrict;
alter table seed_artists         add column if not exists artist_id uuid references artists(id) on delete restrict;
alter table listened_artists     add column if not exists artist_id uuid references artists(id) on delete restrict;
alter table artist_tracks_cache  add column if not exists artist_id uuid references artists(id) on delete restrict;
alter table artist_external_links add column if not exists artist_id uuid references artists(id) on delete restrict;

update recommendation_cache  t set artist_id = a.id from artists a where a.spotify_id = t.spotify_artist_id and t.artist_id is null;
update feedback              t set artist_id = a.id from artists a where a.spotify_id = t.spotify_artist_id and t.artist_id is null;
update saves                 t set artist_id = a.id from artists a where a.spotify_id = t.spotify_artist_id and t.artist_id is null;
update seed_artists          t set artist_id = a.id from artists a where a.spotify_id = t.spotify_artist_id and t.artist_id is null;
update listened_artists      t set artist_id = a.id from artists a where a.spotify_id = t.spotify_artist_id and t.spotify_artist_id is not null and t.artist_id is null;
update artist_tracks_cache   t set artist_id = a.id from artists a where a.spotify_id = t.spotify_artist_id and t.artist_id is null;
update artist_external_links t set artist_id = a.id from artists a where a.spotify_id = t.spotify_artist_id and t.artist_id is null;

-- ============================================================================
-- 4. Re-serialize recommendation_cache.artist_data blobs (ADR-0001 decision 6)
--    id → uuid, add spotifyId → <old id>. Guarded so it's idempotent.
-- ============================================================================
update recommendation_cache rc
set artist_data = jsonb_set(
      jsonb_set(rc.artist_data, '{spotifyId}', coalesce(rc.artist_data->'id', 'null'::jsonb)),
      '{id}', to_jsonb(rc.artist_id::text)
    )
where rc.artist_id is not null
  and rc.artist_data is not null            -- guard: NULL::jsonb ? key yields NULL, not false
  and not (rc.artist_data ? 'spotifyId');

-- ============================================================================
-- 5. Integrity guard: every CURRENT row in a non-nullable-identity table must
--    have resolved an artist_id (catches backfill holes BEFORE we add unique).
--    listened_artists is exempt (name-only Last.fm rows legitimately have none).
-- ============================================================================
do $$
begin
  if exists (select 1 from recommendation_cache  where artist_id is null) then raise exception '0036: recommendation_cache has % unresolved artist_id rows', (select count(*) from recommendation_cache where artist_id is null); end if;
  if exists (select 1 from feedback              where artist_id is null) then raise exception '0036: feedback has unresolved artist_id rows'; end if;
  if exists (select 1 from saves                 where artist_id is null) then raise exception '0036: saves has unresolved artist_id rows'; end if;
  if exists (select 1 from seed_artists          where artist_id is null) then raise exception '0036: seed_artists has unresolved artist_id rows'; end if;
  if exists (select 1 from artist_tracks_cache   where artist_id is null) then raise exception '0036: artist_tracks_cache has unresolved artist_id rows'; end if;
  if exists (select 1 from artist_external_links where artist_id is null) then raise exception '0036: artist_external_links has unresolved artist_id rows'; end if;
end $$;

-- ============================================================================
-- 6. Make spotify_artist_id NULLABLE so NEW code can write artist_id-only rows
--    (old code still writes spotify_artist_id; both coexist). §A.9.
--    artist_tracks_cache / artist_external_links keep spotify_artist_id as their
--    PK (deferred swap, §C) — not touched here.
-- ============================================================================
alter table recommendation_cache alter column spotify_artist_id drop not null;
alter table feedback             alter column spotify_artist_id drop not null;
alter table saves                alter column spotify_artist_id drop not null;
alter table seed_artists         alter column spotify_artist_id drop not null;

-- ============================================================================
-- 7. NEW unique constraints on artist_id, ALONGSIDE the old spotify ones.
--    Nullable artist_id → these dedup only non-null (new-code) rows; old unique
--    keeps deduping the old-code rows. (drop-if-exists for rehearsal re-runs.)
-- ============================================================================
alter table recommendation_cache drop constraint if exists recommendation_cache_user_id_artist_id_key;
alter table recommendation_cache add  constraint recommendation_cache_user_id_artist_id_key unique (user_id, artist_id);
alter table feedback             drop constraint if exists feedback_user_id_artist_id_key;
alter table feedback             add  constraint feedback_user_id_artist_id_key unique (user_id, artist_id);
alter table saves                drop constraint if exists saves_user_id_artist_id_key;
alter table saves                add  constraint saves_user_id_artist_id_key unique (user_id, artist_id);
alter table seed_artists         drop constraint if exists seed_artists_user_id_artist_id_key;
alter table seed_artists         add  constraint seed_artists_user_id_artist_id_key unique (user_id, artist_id);

-- artist_tracks_cache / artist_external_links: future identity key (nullable;
-- writes stay spotify-keyed until the deferred swap). Unique allows nulls.
alter table artist_tracks_cache   drop constraint if exists artist_tracks_cache_artist_id_key;
alter table artist_tracks_cache   add  constraint artist_tracks_cache_artist_id_key unique (artist_id);
alter table artist_external_links drop constraint if exists artist_external_links_artist_id_key;
alter table artist_external_links add  constraint artist_external_links_artist_id_key unique (artist_id);

-- listened_artists: nullable artist_id → partial unique; plus the artist_id-based
-- twin of the unresolved-name index. The OLD `…_unresolved_idx` (where spotify_artist_id
-- is null) is intentionally KEPT ALIVE for the deploy gap (old code's name-only sentinel)
-- and is dropped in 0037 alongside the spotify_artist_id columns.
drop index if exists listened_artists_user_artist_uidx;
create unique index listened_artists_user_artist_uidx on listened_artists (user_id, artist_id) where artist_id is not null;
drop index if exists listened_artists_user_name_unresolved_artistid_idx;
create index listened_artists_user_name_unresolved_artistid_idx on listened_artists (user_id, lastfm_artist_name) where lastfm_artist_name is not null and artist_id is null;

-- ============================================================================
-- 8. explore_cache.artist_ids is text[] of spotify ids — cannot cast in place.
--    Self-heals on next /explore load (24h TTL). §A.6.
-- ============================================================================
delete from explore_cache;

-- ============================================================================
-- 9. NEW UUID RPC overloads (p_artist_id UUID). The old (…,TEXT,…) overloads are
--    KEPT ALIVE for the deploy gap; 0037 drops them. Bodies mirror 0033/0034
--    exactly, with spotify_artist_id → artist_id and the conflict target swapped.
--    🔴 A changed-param-type CREATE makes a NEW overload that is PUBLIC-EXECUTE-
--    able by default → REVOKE on the new signature is load-bearing security.
-- ============================================================================
create or replace function rpc_record_feedback(
  p_user_id   uuid,
  p_artist_id uuid,
  p_signal    text
) returns void
language plpgsql
as $$
declare
  v_previous_signal text;
  v_was_deleted     boolean := false;
  v_week_start      date;
begin
  if p_signal not in ('thumbs_up', 'thumbs_down', 'skip') then
    raise exception 'invalid signal: %', p_signal;
  end if;

  if p_signal <> 'skip' then
    select signal, deleted_at is not null
      into v_previous_signal, v_was_deleted
      from feedback
      where user_id = p_user_id and artist_id = p_artist_id
      limit 1;

    insert into feedback (user_id, artist_id, signal, deleted_at)
    values (p_user_id, p_artist_id, p_signal, null)
    on conflict (user_id, artist_id)
    do update set signal = excluded.signal, deleted_at = null;
  end if;

  update recommendation_cache
  set seen_at = now(),
      skip_at = case when p_signal = 'skip' then now() else skip_at end
  where user_id = p_user_id and artist_id = p_artist_id;

  if p_signal = 'thumbs_up' and (
    v_previous_signal is null or v_was_deleted or v_previous_signal <> 'thumbs_up'
  ) then
    v_week_start := date_trunc('week', (now() at time zone 'UTC'))::date;
    perform rpc_increment_challenge_progress(p_user_id, v_week_start, p_signal, 1);
  end if;
end;
$$;

create or replace function rpc_delete_feedback(
  p_user_id   uuid,
  p_artist_id uuid
) returns void
language plpgsql
as $$
begin
  update feedback
  set deleted_at = now()
  where user_id = p_user_id and artist_id = p_artist_id;
  -- Intentionally does NOT touch recommendation_cache.seen_at (session-only undo).
end;
$$;

create or replace function rpc_clear_dismiss(
  p_user_id   uuid,
  p_artist_id uuid
) returns void
language plpgsql
as $$
begin
  update recommendation_cache
  set skip_at = null, seen_at = null
  where user_id = p_user_id and artist_id = p_artist_id;
end;
$$;

-- 🔴 REVOKE the new UUID overloads from PUBLIC/anon/authenticated (server-only;
--    app calls through the service client). The RPCs trust p_user_id, so safety
--    rests entirely on these revokes.
revoke execute on function rpc_record_feedback(uuid, uuid, text) from public;
revoke execute on function rpc_record_feedback(uuid, uuid, text) from anon;
revoke execute on function rpc_record_feedback(uuid, uuid, text) from authenticated;
revoke execute on function rpc_delete_feedback(uuid, uuid) from public;
revoke execute on function rpc_delete_feedback(uuid, uuid) from anon;
revoke execute on function rpc_delete_feedback(uuid, uuid) from authenticated;
revoke execute on function rpc_clear_dismiss(uuid, uuid) from public;
revoke execute on function rpc_clear_dismiss(uuid, uuid) from anon;
revoke execute on function rpc_clear_dismiss(uuid, uuid) from authenticated;
