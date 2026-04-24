import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { invalidateExploreCache } from "@/lib/recommendation/explore-engine"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ artistId: string }> }
): Promise<Response> {
  const blocked = enforceSameOrigin(request)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const { artistId } = await params

  if (!isValidSpotifyId(artistId)) return apiError("Invalid artist ID", 400)

  const supabase = createServiceClient()

  const { error: rpcError } = await supabase.rpc("rpc_clear_dismiss", {
    p_user_id: userId,
    p_artist_id: artistId,
  })

  if (rpcError) return dbError(rpcError, "dismiss/clear-rpc")

  // Explore caches include the server-side skip_at filter, so cached rails
  // omit the artist. Wipe the cache so the next Explore load can re-include.
  await invalidateExploreCache(userId).catch((err) => {
    console.error("[dismiss] explore-invalidate failed", err)
  })

  return new Response(null, { status: 204 })
}
