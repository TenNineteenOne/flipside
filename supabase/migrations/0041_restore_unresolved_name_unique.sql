-- 0041 — restore the UNIQUE guard on unresolved name-only listened_artists rows,
--        + an atomic play-count bump RPC.
--
-- WHAT THIS FIXES
--   0017 had a UNIQUE partial index on (user_id, lastfm_artist_name) WHERE the
--   row was unresolved ("prevent duplicate unresolved name-only rows across
--   sources"). 0036:195 replaced it with a NON-unique index (predicated on
--   artist_id IS NULL), and 0039's `drop column spotify_artist_id cascade`
--   removed the old unique with it. Net: concurrent Last.fm + stats.fm syncs can
--   insert duplicate name-only rows for the same (user, artist), and the 23505
--   conflictFallback in lib/history/listened-upsert.ts became dead code. The
--   owner's July review measured ~32% duplicate name-only rows. This restores
--   the unique index and de-dupes the rows already leaked in.
--
--   (c) also adds rpc_bump_listened_play_counts: the app currently bumps
--   play_count via a read-modify-write (SELECT play_count → write play_count+1),
--   which loses concurrent increments. The RPC does an atomic `+ 1` in the DB.
--
-- WHY DEDUPE MUST PRECEDE THE INDEX
--   `create unique index` fails outright if any duplicate group still exists, so
--   the fold-and-delete in (a) has to run first, under the SAME predicate the
--   index uses.
--
-- 🔴 APPLY ORDER (loud): this migration MUST be applied (rehearsal first per
--   project convention, then prod) BEFORE the D2 app change deploys. That deploy
--   calls rpc_bump_listened_play_counts — the function has to exist first or every
--   history sync errors on the bump. The index/dedupe half is safe to apply early
--   (it only removes dupes the app already can't distinguish).
--
-- Runs as one implicit transaction under scripts/_replay.ts. Idempotent /
-- re-runnable on rehearsal (drop-if-exists, HAVING count>1, create-or-replace).
--
-- NOTE ON THE ORIGINAL D4 (account-deletion FK cascades): the review brief asked
-- to add ON DELETE CASCADE to groups.created_by and group_activity.user_id. Those
-- tables were permanently dropped in 0010_remove_social_features and never
-- recreated, so there is nothing to alter — every table that currently references
-- users(id) already has ON DELETE CASCADE (verified against 0001 + 0025 + 0026).
-- The account/route.ts "all child tables cascade" comment is therefore already
-- true. D4 is intentionally omitted.

-- ============================================================================
-- (a) Dedupe existing unresolved name-only duplicates.
--     Group = (user_id, lastfm_artist_name) over rows WHERE lastfm_artist_name
--     IS NOT NULL AND artist_id IS NULL — exactly the index predicate below.
--     Keeper = earliest created_at (id as uuid tiebreak). Merge into the keeper:
--       play_count               → SUM across the group
--       last_seen_at             → MAX
--       id_resolution_attempted_at → MAX (keep the most recent resolution attempt
--                                    so we don't needlessly re-resolve)
--     source / created_at stay the keeper's. Non-keepers are deleted.
--     (listened_artists columns as of 0039: id, user_id, lastfm_artist_name,
--      source, play_count, last_seen_at, created_at, id_resolution_attempted_at,
--      artist_id — all accounted for above.)
-- ============================================================================

-- (a.1) Fold the losers' counts/timestamps into each group's keeper. Only groups
--       with >1 unresolved row are touched, so re-runs are no-ops.
with grp as (
  select id, user_id, lastfm_artist_name, play_count, last_seen_at,
         id_resolution_attempted_at, created_at
  from listened_artists
  where lastfm_artist_name is not null and artist_id is null
),
agg as (
  select user_id, lastfm_artist_name,
         sum(play_count)                as total_plays,
         max(last_seen_at)              as max_last_seen,
         max(id_resolution_attempted_at) as max_attempted
  from grp
  group by user_id, lastfm_artist_name
  having count(*) > 1
),
keepers as (
  select distinct on (g.user_id, g.lastfm_artist_name)
         g.id, a.total_plays, a.max_last_seen, a.max_attempted
  from grp g
  join agg a using (user_id, lastfm_artist_name)
  order by g.user_id, g.lastfm_artist_name, g.created_at asc, g.id asc
)
update listened_artists la
set play_count                = k.total_plays,
    last_seen_at              = k.max_last_seen,
    id_resolution_attempted_at = k.max_attempted
from keepers k
where la.id = k.id;

-- (a.2) Delete the non-keeper rows (rn > 1). Singletons have rn = 1 and are
--       untouched, so this is safe to re-run.
with grp as (
  select id,
         row_number() over (
           partition by user_id, lastfm_artist_name
           order by created_at asc, id asc
         ) as rn
  from listened_artists
  where lastfm_artist_name is not null and artist_id is null
)
delete from listened_artists
where id in (select id from grp where rn > 1);

-- ============================================================================
-- (b) Replace the non-unique 0036 index with a UNIQUE one (restores the 0017
--     guard). Same predicate as the dedupe above.
-- ============================================================================
drop index if exists listened_artists_user_name_unresolved_artistid_idx;
create unique index if not exists listened_artists_user_name_unresolved_uidx
  on listened_artists (user_id, lastfm_artist_name)
  where lastfm_artist_name is not null and artist_id is null;

-- ============================================================================
-- (c) Atomic play-count bump RPC (replaces the app-side read-modify-write, which
--     loses concurrent increments). id is uuid → p_ids is uuid[].
--     Grants match the rpc_*_v2 pattern from 0036: plain plpgsql (no SECURITY
--     DEFINER), EXECUTE revoked from public/anon/authenticated so only the
--     service role (which the server uses) can call it — anon gets NONE.
-- ============================================================================
create or replace function rpc_bump_listened_play_counts(
  p_user_id uuid,
  p_ids     uuid[],
  p_now     timestamptz
) returns void
language plpgsql
as $$
begin
  update listened_artists
  set play_count   = play_count + 1,
      last_seen_at = p_now
  where id = any(p_ids) and user_id = p_user_id;
end;
$$;

revoke execute on function rpc_bump_listened_play_counts(uuid, uuid[], timestamptz) from public;
revoke execute on function rpc_bump_listened_play_counts(uuid, uuid[], timestamptz) from anon;
revoke execute on function rpc_bump_listened_play_counts(uuid, uuid[], timestamptz) from authenticated;
