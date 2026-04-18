import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import { accumulateLastFmHistory } from "@/lib/listened-artists"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"

export async function POST(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("lastfm_username, last_accumulated_at")
    .eq("id", userId)
    .maybeSingle()

  if (userError) {
    console.error("[history/accumulate] User lookup error:", userError.message)
    return apiError("Failed to load user profile")
  }

  if (!user) return apiError("User not found", 404)

  if (!user.lastfm_username) {
    return apiError("No Last.fm account connected", 400)
  }

  // Per-user cooldown: 15 minutes between accumulate requests
  if (user.last_accumulated_at) {
    const elapsed = Date.now() - new Date(user.last_accumulated_at).getTime()
    if (elapsed < 15 * 60_000) {
      return apiError("Please wait before syncing again", 429)
    }
  }

  // Update cooldown timestamp
  await supabase.from("users").update({ last_accumulated_at: new Date().toISOString() }).eq("id", userId)

  try {
    const accessToken = await getSpotifyClientToken() ?? ""
    await accumulateLastFmHistory({
      userId,
      lastfmUsername: user.lastfm_username,
      accessToken,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Accumulation failed"
    console.error("[history/accumulate] Error:", message)
    return apiError("History accumulation failed", 500)
  }

  return Response.json({ success: true })
}
