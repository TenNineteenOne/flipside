import { createServiceClient } from "@/lib/supabase/server"
import { apiError, dbError } from "@/lib/errors"
import { isValidArtistId } from "@/lib/spotify-ids"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"
import { onTasteChanged } from "@/lib/taste-change"

export const DELETE = withAuthedCsrfRoute(
  async ({ userId }, { params }: { params: Promise<{ artistId: string }> }) => {
    const { artistId } = await params

    if (!isValidArtistId(artistId)) return apiError("Invalid artist ID", 400)

    const supabase = createServiceClient()

    const { error: rpcError } = await supabase.rpc("rpc_delete_feedback_v2", {
      p_user_id: userId,
      p_artist_id: artistId,
    })

    if (rpcError) return dbError(rpcError, "feedback/delete-rpc")

    // Un-thumb reverses a taste signal — invalidate the same rails a thumbs
    // POST without railKey does (#175 owner decision 5).
    await onTasteChanged(supabase, userId, { kind: "feedback" })

    return new Response(null, { status: 204 })
  }
)
