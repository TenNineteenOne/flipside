import { createServiceClient } from "@/lib/supabase/server"
import { apiError, dbError } from "@/lib/errors"
import { isValidArtistId } from "@/lib/spotify-ids"
import { invalidateExploreCache } from "@/lib/recommendation/explore-engine"
import type { RailKey } from "@/lib/recommendation/explore-engine"
import { withAuthedJsonRoute } from "@/lib/api/with-authed-route"

const RAIL_KEYS = ["adjacent", "outside", "wildcards", "leftfield"] as const
function isRailKey(v: unknown): v is RailKey {
  return typeof v === "string" && (RAIL_KEYS as readonly string[]).includes(v)
}

export const POST = withAuthedJsonRoute(async ({ userId, body }) => {
  const { artistId, signal, railKey } = body as {
    artistId?: string
    signal?: string
    railKey?: string
  }
  if (!artistId || !isValidArtistId(artistId))
    return apiError("Valid artistId (uuid) is required", 400)
  if (signal !== "thumbs_up" && signal !== "thumbs_down" && signal !== "skip")
    return apiError("signal must be thumbs_up, thumbs_down, or skip", 400)
  if (railKey !== undefined && !isRailKey(railKey))
    return apiError("railKey must be one of adjacent | outside | wildcards | leftfield", 400)

  const supabase = createServiceClient()

  const { error: rpcError } = await supabase.rpc("rpc_record_feedback", {
    p_user_id: userId,
    p_artist_id: artistId,
    p_signal: signal,
  })

  if (rpcError) return dbError(rpcError, "feedback/rpc")

  // Thumbs change the user's taste signal. When the signal came from a specific
  // Explore rail (railKey set), narrow-invalidate only that rail — the other
  // rails pick up the feedback row on their natural 24h TTL rebuild. When no
  // railKey is provided (Feed thumbs, non-Explore callers), fall back to the
  // full-wipe so those contexts keep their existing semantics.
  if (signal === "thumbs_up" || signal === "thumbs_down") {
    const rails = railKey ? [railKey] : undefined
    await invalidateExploreCache(userId, rails).catch((err) => {
      console.error("[feedback] explore-invalidate failed", err)
    })
  }

  return Response.json({ success: true })
})
