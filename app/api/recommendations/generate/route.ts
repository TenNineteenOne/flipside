import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { accumulateSpotifyHistory } from "@/lib/listened-artists"
import { buildRecommendations } from "@/lib/recommendation/engine"

export async function POST(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const supabase = createServiceClient()

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, play_threshold")
    .eq("spotify_id", session.user.spotifyId)
    .maybeSingle()

  if (userError || !user) return apiError("User not found", 404)

  try {
    // Accumulate Spotify history first so play counts are fresh
    await accumulateSpotifyHistory({
      userId: user.id,
      accessToken: session.user.accessToken,
    })

    const count = await buildRecommendations({
      userId: user.id,
      accessToken: session.user.accessToken,
      spotifyId: session.user.spotifyId,
      playThreshold: user.play_threshold ?? 25,
    })

    return Response.json({ success: true, count })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed"
    console.error("[recommendations/generate] Error:", message)
    return apiError(message)
  }
}
