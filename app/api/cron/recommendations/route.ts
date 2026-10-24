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

  // Step 2: hard-delete anything that's been expired for > 30 days, regardless
  // of seen_at. Prevents unbounded table growth over months of production use.
  // Exception: rows with skip_at set are permanent dismissals — deleting them
  // would let the artist resurface in Explore/Feed ~60 days after dismissal.
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: deletedRows, error: deleteErr } = await supabase
    .from("recommendation_cache")
    .delete()
    .lt("expires_at", thirtyDaysAgo.toISOString())
    .is("skip_at", null)
    .select("id")

  if (deleteErr) {
    console.error("[cron/recommendations] Delete error:", deleteErr.message)
    // Don't fail the whole job — expiration already succeeded.
  }

  const expiredCount = expiredRows?.length ?? 0
  const deletedCount = deletedRows?.length ?? 0
  console.log(
    `[cron/recommendations] Expired ${expiredCount} stale entries; deleted ${deletedCount} > 30d old`,
  )
  return Response.json({ success: true, expired: expiredCount, deleted: deletedCount })
})
