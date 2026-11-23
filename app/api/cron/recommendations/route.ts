import { apiError } from "@/lib/errors"
import { withCronRoute } from "@/lib/api/with-authed-route"

export const GET = withCronRoute("cron", async ({ supabase }) => {
  const now = new Date()

  const threeDaysAgo = new Date(now)
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

  // Step 1: mark stale unseen entries as expired (so they won't surface).
  const { data: expiredRows, error: expireErr } = await supabase
    .from("recommendation_cache")
    .update({ expires_at: now.toISOString() })
    .is("seen_at", null)
    .lt("created_at", threeDaysAgo.toISOString())
    // Only rows not already expired: re-stamping expires_at=now every day kept
    // them forever younger than step 2's 30-day delete cutoff.
    .gt("expires_at", now.toISOString())
    .select("id")

  if (expireErr) {
    console.error("[cron/recommendations] Expire error:", expireErr.message)
    return apiError("An unexpected error occurred", 500)
  }

  // Step 2: hard-delete anything that's been expired for > 30 days. Prevents
  // unbounded table growth over months of production use. Kept forever:
  //   - rows with skip_at set (permanent dismissals: deleting them would let
  //     the artist resurface in the Feed ~60 days after dismissal);
  //   - seen rows whose artist the user liked, passed or saved (#219: History
  //     reads this table, so a verdict must not drop out of it).
  // The second exception needs a join, so the delete lives in
  // rpc_prune_recommendation_cache (migration 0045). If the RPC fails or is not
  // applied yet, nothing is deleted this run: the plain delete would remove the
  // rows we mean to keep.
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: deleted, error: deleteErr } = await supabase.rpc("rpc_prune_recommendation_cache", {
    p_cutoff: thirtyDaysAgo.toISOString(),
  })

  if (deleteErr) {
    console.warn("[cron/recommendations] prune skipped (is migration 0045 applied?):", deleteErr.message)
    // Don't fail the whole job — expiration already succeeded.
  }

  // Step 3: drop login rate-limit rows (hashed visitor IPs) a day past their
  // 1-minute window; nothing reads them after that.
  const { error: attemptsErr } = await supabase
    .from("login_attempts")
    .delete()
    .lt("window_start", new Date(now.getTime() - 86_400_000).toISOString())

  if (attemptsErr) {
    console.error("[cron/recommendations] login_attempts delete error:", attemptsErr.message)
    // Don't fail the whole job — the cache cleanup already ran.
  }

  const expiredCount = expiredRows?.length ?? 0
  const deletedCount = typeof deleted === "number" ? deleted : 0
  console.log(
    `[cron/recommendations] Expired ${expiredCount} stale entries; deleted ${deletedCount} > 30d old`,
  )
  return Response.json({ success: true, expired: expiredCount, deleted: deletedCount })
})
