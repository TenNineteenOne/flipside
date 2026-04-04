import { createServiceClient } from "@/lib/supabase/server"
import { NextRequest } from "next/server"

export async function GET(req: NextRequest) {
  // Verify CRON_SECRET if configured (skipped in dev when env var is absent)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${cronSecret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const supabase = createServiceClient()
  const now = new Date()

  // Expire unseen recommendations older than 3 days so they get refreshed on next visit
  const threeDaysAgo = new Date(now)
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

  const { data, error } = await supabase
    .from("recommendation_cache")
    .update({ expires_at: now.toISOString() })
    .is("seen_at", null)
    .lt("created_at", threeDaysAgo.toISOString())
    .select("id")

  const count = data?.length ?? 0

  if (error) {
    console.error("[cron/recommendations] Error:", error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }

  console.log(`[cron/recommendations] Expired ${count ?? 0} stale cache entries`)
  return Response.json({ success: true, expired: count ?? 0 })
}
