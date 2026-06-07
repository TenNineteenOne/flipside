import { createServiceClient } from "@/lib/supabase/server"
import { apiError, dbError } from "@/lib/errors"
import { isValidArtistId } from "@/lib/spotify-ids"
import { invalidateExploreCache } from "@/lib/recommendation/explore-engine"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"

export const DELETE = withAuthedCsrfRoute(
  async ({ userId }, { params }: { params: Promise<{ artistId: string }> }) => {
    const { artistId } = await params

    if (!isValidArtistId(artistId)) return apiError("Invalid artist ID", 400)

    const supabase = createServiceClient()

    const { error: rpcError } = await supabase.rpc("rpc_clear_dismiss_v2", {
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
)
