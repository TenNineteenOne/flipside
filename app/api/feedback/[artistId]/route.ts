import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getUserId } from "@/lib/groups"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ artistId: string }> }
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

  const userId = await getUserId(session.user.spotifyId)
  if (!userId) return apiUnauthorized()

  const { artistId } = await params

  const supabase = createServiceClient()

  // Soft-delete the feedback row
  const { error: feedbackError } = await supabase
    .from("feedback")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("spotify_artist_id", artistId)

  if (feedbackError) return apiError(feedbackError.message)

  // Clear seen_at in recommendation_cache
  const { error: cacheError } = await supabase
    .from("recommendation_cache")
    .update({ seen_at: null })
    .eq("user_id", userId)
    .eq("spotify_artist_id", artistId)

  if (cacheError) return apiError(cacheError.message)

  return new Response(null, { status: 204 })
}
