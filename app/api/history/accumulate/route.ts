import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import { accumulateLastFmHistory } from "@/lib/listened-artists"
import { accumulateStatsFmHistory } from "@/lib/statsfm-listened-artists"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"

const COOLDOWN_MS = 15 * 60_000
type Source = "lastfm" | "statsfm"

export async function POST(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  let source: Source
  try {
    const body = (await request.json().catch(() => ({}))) as { source?: unknown }
    if (body.source !== "lastfm" && body.source !== "statsfm") {
      return apiError("source must be 'lastfm' or 'statsfm'", 400)
    }
    source = body.source
  } catch {
    return apiError("Invalid JSON body", 400)
  }

  const supabase = createServiceClient()

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("lastfm_username, statsfm_username, last_accumulated_lastfm_at, last_accumulated_statsfm_at")
    .eq("id", userId)
    .maybeSingle()

  if (userError) {
    console.error("[history/accumulate] User lookup error:", userError.message)
    return apiError(`Failed to load user profile: ${userError.message}`, 500)
  }
  if (!user) return apiError("User not found", 404)

  const username = source === "lastfm" ? user.lastfm_username : user.statsfm_username
  const cooldownField = source === "lastfm" ? "last_accumulated_lastfm_at" : "last_accumulated_statsfm_at"
  const lastAt = source === "lastfm" ? user.last_accumulated_lastfm_at : user.last_accumulated_statsfm_at

  if (!username) {
    return apiError(`No ${source === "lastfm" ? "Last.fm" : "stats.fm"} account connected`, 400)
  }

  if (lastAt) {
    const elapsed = Date.now() - new Date(lastAt).getTime()
    if (elapsed < COOLDOWN_MS) {
      return apiError("Please wait before syncing again", 429)
    }
  }

  try {
    const accessToken = (await getSpotifyClientToken()) ?? ""
    if (source === "lastfm") {
      await accumulateLastFmHistory({ userId, lastfmUsername: username, accessToken })
    } else {
      await accumulateStatsFmHistory({ userId, statsfmUsername: username, accessToken })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Accumulation failed"
    console.error(`[history/accumulate] ${source} error:`, message)
    return apiError(`${source === "lastfm" ? "Last.fm" : "stats.fm"} sync failed`, 500)
  }

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from("users")
    .update({ [cooldownField]: now, last_accumulated_at: now })
    .eq("id", userId)
  if (updateError) {
    console.error("[history/accumulate] Cooldown update error:", updateError.message)
  }

  return Response.json({ success: true })
}
