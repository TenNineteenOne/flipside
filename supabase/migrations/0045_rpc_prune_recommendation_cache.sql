-- 0045 — rpc_prune_recommendation_cache: the nightly Feed-queue clean-up, now
--        sparing rows the user gave a verdict on (#219).
--
-- WHAT THIS FIXES
--   History (lib/history/query.ts) lists the SEEN rows of recommendation_cache.
--   The daily cron (app/api/cron/recommendations/route.ts) deleted every row
--   whose expires_at was more than 30 days past, so an artist dropped out of
--   History about 60 days after it was shown, even when the user had liked,
--   passed on or saved it. Owner decision: keep rows the user gave
--   a verdict on; rows that were only seen/skipped still age out.
--
-- WHY AN RPC
--   "Keep the row if a live feedback row or a saves row exists for the same
--   (user, artist)" is a NOT EXISTS join, which PostgREST's filter syntax cannot
--   express. One DELETE statement here replaces the cron's plain delete.
--
-- WHAT IS KEPT (everything else older than p_cutoff is deleted)
--   * skip_at is set                — permanent dismissal (as before);
--   * seen_at is set AND the user has a live like/pass for the artist
--     (feedback.deleted_at is null) or a saves row for it.
--   An un-thumbed (soft-deleted) feedback row does not keep the row. Unseen
--   rows are never kept by a verdict.
--
-- COST
--   The two EXISTS probes use the unique (user_id, artist_id) indexes on
--   feedback and saves (0036). Kept rows are re-checked every night; their
--   number is bounded by the user's likes + passes + saves.
--
-- APPLY ORDER: either order is safe. Until this is applied the cron's RPC call
--   fails, the cron logs a warning and deletes nothing from recommendation_cache
--   that night (it never falls back to the old delete). Additive and
--   re-runnable (create or replace). Returns the number of rows deleted.

create or replace function rpc_prune_recommendation_cache(
  p_cutoff timestamptz
) returns integer
language plpgsql
as $$
declare
  v_deleted integer;
begin
  delete from recommendation_cache rc
  where rc.expires_at < p_cutoff
    and rc.skip_at is null
    and not (
      rc.seen_at is not null
      and (
        exists (
          select 1 from feedback f
          where f.user_id = rc.user_id and f.artist_id = rc.artist_id and f.deleted_at is null
        )
        or exists (
          select 1 from saves s
          where s.user_id = rc.user_id and s.artist_id = rc.artist_id
        )
      )
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Server-only: called via the service-role client from the cron route.
revoke execute on function rpc_prune_recommendation_cache(timestamptz) from public;
revoke execute on function rpc_prune_recommendation_cache(timestamptz) from anon;
revoke execute on function rpc_prune_recommendation_cache(timestamptz) from authenticated;
