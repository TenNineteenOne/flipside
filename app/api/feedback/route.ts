import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { getUserId } from "@/lib/groups"

export async function POST(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const userId = await getUserId(session.user.spotifyId)
  if (!userId) return apiUnauthorized()

  let body: { spotifyArtistId?: string; signal?: string }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const { spotifyArtistId, signal } = body
  if (!spotifyArtistId || !isValidSpotifyId(spotifyArtistId))
    return apiError("Valid spotifyArtistId is required", 400)
  if (signal !== "thumbs_up" && signal !== "thumbs_down")
    return apiError("signal must be thumbs_up or thumbs_down", 400)

  const supabase = createServiceClient()

  // Upsert feedback
  const { error: feedbackError } = await supabase
    .from("feedback")
    .upsert(
      { user_id: userId, spotify_artist_id: spotifyArtistId, signal, deleted_at: null },
      { onConflict: "user_id,spotify_artist_id" }
    )

  if (feedbackError) return dbError(feedbackError, "feedback/upsert")

  // Update seen_at in recommendation_cache
  const { error: cacheError } = await supabase
    .from("recommendation_cache")
    .update({ seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("spotify_artist_id", spotifyArtistId)

  if (cacheError) return dbError(cacheError, "feedback/cache-update")

  // If thumbs_up, write group_activity for all user's groups
  if (signal === "thumbs_up") {
    // Fetch artist name from recommendation_cache
    const { data: cacheData } = await supabase
      .from("recommendation_cache")
      .select("artist_data")
      .eq("user_id", userId)
      .eq("spotify_artist_id", spotifyArtistId)
      .maybeSingle()

    const artistName: string = cacheData ? (cacheData.artist_data as any).name ?? "" : ""

    // Fetch all groups this user belongs to
    const { data: memberships, error: membershipsError } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)

    if (membershipsError) return dbError(membershipsError, "feedback/memberships")

    if (memberships && memberships.length > 0) {
      const activityRows = memberships.map((m: { group_id: string }) => ({
        user_id: userId,
        group_id: m.group_id,
        spotify_artist_id: spotifyArtistId,
        artist_name: artistName,
        action_type: "thumbs_up" as const,
      }))

      const { error: activityError } = await supabase
        .from("group_activity")
        .upsert(activityRows)

      if (activityError) return dbError(activityError, "feedback/activity")
    }
  }

  return Response.json({ success: true })
}
