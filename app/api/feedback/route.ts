import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"

export async function POST(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  let body: { spotifyArtistId?: string; signal?: string }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const { spotifyArtistId, signal } = body
  if (!spotifyArtistId || !isValidSpotifyId(spotifyArtistId))
    return apiError("Valid spotifyArtistId is required", 400)
  if (signal !== "thumbs_up" && signal !== "thumbs_down" && signal !== "skip")
    return apiError("signal must be thumbs_up, thumbs_down, or skip", 400)

  console.log(`[feedback] ${signal} artistId=${spotifyArtistId}`)

  const supabase = createServiceClient()

  // Upsert feedback only if it's an actionable algorithm signal
  if (signal !== "skip") {
    const { error: feedbackError } = await supabase
      .from("feedback")
      .upsert(
        { user_id: userId, spotify_artist_id: spotifyArtistId, signal, deleted_at: null },
        { onConflict: "user_id,spotify_artist_id" }
      )

    if (feedbackError) return dbError(feedbackError, "feedback/upsert")
  }

  // Update seen_at in recommendation_cache
  const { error: cacheError } = await supabase
    .from("recommendation_cache")
    .update({ seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("spotify_artist_id", spotifyArtistId)

  if (cacheError) return dbError(cacheError, "feedback/cache-update")

  return Response.json({ success: true })
}
