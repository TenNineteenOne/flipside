import { auth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { createServiceClient } from "@/lib/supabase/server"
import {
  accumulateSpotifyHistory,
  accumulateLastFmHistory,
} from "@/lib/listened-artists"

export async function POST(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) {
    return apiUnauthorized()
  }

  const supabase = createServiceClient()

  // Look up the Supabase user UUID and lastfm_username for this Spotify ID
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, lastfm_username")
    .eq("spotify_id", session.user.spotifyId)
    .maybeSingle()

  if (userError) {
    console.error("[history/accumulate] User lookup error:", userError.message)
    return apiError("Failed to load user profile")
  }

  if (!user) {
    return apiError("User not found", 404)
  }

  try {
    // Always accumulate Spotify history
    await accumulateSpotifyHistory({
      userId: user.id,
      accessToken: session.user.accessToken,
    })

    // Accumulate Last.fm history if username is set
    if (user.lastfm_username) {
      await accumulateLastFmHistory({
        userId: user.id,
        lastfmUsername: user.lastfm_username,
      })
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Accumulation failed"
    console.error("[history/accumulate] Error:", message)
    return apiError(message)
  }

  return Response.json({ success: true })
}
