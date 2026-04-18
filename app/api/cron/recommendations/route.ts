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

  const { data, error } = await supabase
    .from("recommendation_cache")
    .update({ expires_at: now.toISOString() })
    .is("seen_at", null)
    .lt("created_at", threeDaysAgo.toISOString())
    .select("id")

  if (error) {
    console.error("[cron/recommendations] Error:", error.message)
    return Response.json({ error: "An unexpected error occurred" }, { status: 500 })
  }

  const count = data?.length ?? 0
  console.log(`[cron/recommendations] Expired ${count} stale cache entries`)
  return Response.json({ success: true, expired: count })
}
