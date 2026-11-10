import { createServiceClient } from "@/lib/supabase/server"
import { apiError, dbError } from "@/lib/errors"
import { isValidArtistId } from "@/lib/spotify-ids"
import { onTasteChanged } from "@/lib/taste-change"
import { withAuthedJsonRoute } from "@/lib/api/with-authed-route"
import { ensureCurrentChallenge } from "@/lib/challenges/engine"

export const POST = withAuthedJsonRoute(async ({ userId, body }) => {
  // Old Explore clients may still send `railKey`; it is ignored.
  const { artistId, signal } = body as { artistId?: string; signal?: string }
  if (!artistId || !isValidArtistId(artistId))
    return apiError("Valid artistId (uuid) is required", 400)
  if (signal !== "thumbs_up" && signal !== "thumbs_down" && signal !== "skip")
    return apiError("signal must be thumbs_up, thumbs_down, or skip", 400)

  const supabase = createServiceClient()

  // The feedback RPC credits the weekly challenge but no-ops when this week's
  // row doesn't exist yet, so assign it first. Best-effort: never fails the feedback write.
  if (signal === "thumbs_up") {
    await ensureCurrentChallenge(supabase, userId).catch((err) => {
      console.error("[feedback] ensure-challenge failed", err instanceof Error ? err.message : err)
    })
  }

  const { error: rpcError } = await supabase.rpc("rpc_record_feedback_v2", {
    p_user_id: userId,
    p_artist_id: artistId,
    p_signal: signal,
  })

  if (rpcError) return dbError(rpcError, "feedback/rpc")

  // Thumbs change the user's taste signal (see lib/taste-change). A skip is not.
  if (signal === "thumbs_up" || signal === "thumbs_down") {
    await onTasteChanged(supabase, userId, { kind: "feedback" })
  }

  return Response.json({ success: true })
})
