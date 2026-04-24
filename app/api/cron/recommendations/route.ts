import { createServiceClient } from "@/lib/supabase/server"
import { createHmac, timingSafeEqual } from "crypto"
import { NextRequest } from "next/server"

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error("[cron] CRON_SECRET is not set — refusing request")
    return Response.json({ error: "Server misconfigured" }, { status: 500 })
  }
  const authHeader = req.headers.get("authorization") ?? ""
  const expected = `Bearer ${cronSecret}`
  // HMAC both values to fixed-length digests — prevents length-leak from direct comparison
  const hmac = (v: string) => createHmac("sha256", "cron-compare").update(v).digest()
  if (!timingSafeEqual(hmac(authHeader), hmac(expected))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createServiceClient()
  const now = new Date()

  const threeDaysAgo = new Date(now)
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

  // Step 1: mark stale unseen entries as expired (so they won't surface).
  const { data: expiredRows, error: expireErr } = await supabase
    .from("recommendation_cache")
    .update({ expires_at: now.toISOString() })
    .is("seen_at", null)
    .lt("created_at", threeDaysAgo.toISOString())
    .select("id")

  if (expireErr) {
    console.error("[cron/recommendations] Expire error:", expireErr.message)
    return Response.json({ error: "An unexpected error occurred" }, { status: 500 })
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
}
