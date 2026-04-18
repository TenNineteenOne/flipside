import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ artistId: string }> }
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const { artistId } = await params

  if (!isValidSpotifyId(artistId)) return apiError("Invalid artist ID", 400)

  const supabase = createServiceClient()

  // Soft-delete the feedback row
  const { error: feedbackError } = await supabase
    .from("feedback")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("spotify_artist_id", artistId)

  if (feedbackError) return dbError(feedbackError, "feedback/delete")

  // Clear seen_at in recommendation_cache
  const { error: cacheError } = await supabase
    .from("recommendation_cache")
    .update({ seen_at: null })
    .eq("user_id", userId)
    .eq("spotify_artist_id", artistId)

  if (cacheError) return dbError(cacheError, "feedback/cache-clear")

  return new Response(null, { status: 204 })
}
