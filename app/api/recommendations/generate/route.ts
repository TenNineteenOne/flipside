import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { accumulateSpotifyHistory } from "@/lib/listened-artists"
import { buildRecommendations } from "@/lib/recommendation/engine"
import { type NextRequest } from "next/server"

export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const accessToken = await getAccessToken(req)
  if (!accessToken) return apiUnauthorized()

  const supabase = createServiceClient()

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, play_threshold")
    .eq("spotify_id", session.user.spotifyId)
    .maybeSingle()

  if (userError || !user) return apiError("User not found", 404)

  try {
    // Clear all unseen cache entries before regenerating.
    // Seen entries (seen_at IS NOT NULL) are preserved.
    // This ensures stale entries (e.g. with empty topTracks) can't block the feed.
    await supabase
      .from("recommendation_cache")
      .delete()
      .eq("user_id", user.id)
      .is("seen_at", null)

    await accumulateSpotifyHistory({
      userId: user.id,
      accessToken,
    })

    const count = await buildRecommendations({
      userId: user.id,
      accessToken,
      spotifyId: session.user.spotifyId,
      playThreshold: user.play_threshold ?? 0,
    })

    return Response.json({ success: true, count })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed"
    console.error("[recommendations/generate] Error:", message)
    return apiError("Recommendation generation failed", 500)
  }
}
