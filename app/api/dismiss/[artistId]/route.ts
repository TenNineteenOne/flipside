import { createServiceClient } from "@/lib/supabase/server"
import { apiError, dbError } from "@/lib/errors"
import { isValidArtistId } from "@/lib/spotify-ids"
import { onTasteChanged } from "@/lib/taste-change"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"

export const DELETE = withAuthedCsrfRoute(
  async ({ userId }, { params }: { params: Promise<{ artistId: string }> }) => {
    const { artistId } = await params

    if (!isValidArtistId(artistId)) return apiError("Invalid artist ID", 400)

    const supabase = createServiceClient()

    // The RPC keeps the row's old created_at / expires_at, so the nightly cron would expire the
    // returned card: stamp both like the engine's re-queue. First, so a failure changes nothing.
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + 30)
    const { error: stampError } = await supabase
      .from("recommendation_cache")
      .update({ created_at: now.toISOString(), expires_at: expiresAt.toISOString() })
      .eq("user_id", userId)
      .eq("artist_id", artistId)

    if (stampError) return dbError(stampError, "dismiss/stamp")

    const { error: rpcError } = await supabase.rpc("rpc_clear_dismiss_v2", {
      p_user_id: userId,
      p_artist_id: artistId,
    })

    if (rpcError) return dbError(rpcError, "dismiss/clear-rpc")

    // An undismiss is a taste change (see lib/taste-change).
    await onTasteChanged(supabase, userId, { kind: "undismiss" })

    return new Response(null, { status: 204 })
  }
)
