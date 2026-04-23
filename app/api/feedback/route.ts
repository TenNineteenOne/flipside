import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { invalidateExploreCache } from "@/lib/recommendation/explore-engine"
import type { RailKey } from "@/lib/recommendation/explore-engine"

const RAIL_KEYS = ["adjacent", "outside", "wildcards", "leftfield"] as const
function isRailKey(v: unknown): v is RailKey {
  return typeof v === "string" && (RAIL_KEYS as readonly string[]).includes(v)
}

export async function POST(request: Request): Promise<Response> {
  const blocked = enforceSameOrigin(request)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  let body: { spotifyArtistId?: string; signal?: string; railKey?: string }
  try {
    body = await request.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const { spotifyArtistId, signal, railKey } = body
  if (!spotifyArtistId || !isValidSpotifyId(spotifyArtistId))
    return apiError("Valid spotifyArtistId is required", 400)
  if (signal !== "thumbs_up" && signal !== "thumbs_down" && signal !== "skip")
    return apiError("signal must be thumbs_up, thumbs_down, or skip", 400)
  if (railKey !== undefined && !isRailKey(railKey))
    return apiError("railKey must be one of adjacent | outside | wildcards | leftfield", 400)

  const supabase = createServiceClient()

  const { error: rpcError } = await supabase.rpc("rpc_record_feedback", {
    p_user_id: userId,
    p_artist_id: spotifyArtistId,
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
}
