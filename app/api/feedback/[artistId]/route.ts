import { createServiceClient } from "@/lib/supabase/server"
import { apiError, dbError } from "@/lib/errors"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"

export const DELETE = withAuthedCsrfRoute(
  async ({ userId }, { params }: { params: Promise<{ artistId: string }> }) => {
    const { artistId } = await params

    if (!isValidSpotifyId(artistId)) return apiError("Invalid artist ID", 400)

    const supabase = createServiceClient()

    const { error: rpcError } = await supabase.rpc("rpc_delete_feedback", {
      p_user_id: userId,
      p_artist_id: artistId,
    })

    if (rpcError) return dbError(rpcError, "feedback/delete-rpc")

    return new Response(null, { status: 204 })
  }
)
