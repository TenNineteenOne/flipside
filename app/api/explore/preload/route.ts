import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import { buildExploreRails } from "@/lib/recommendation/explore-engine"
import type { NextRequest } from "next/server"

/**
 * Background warm for the Explore page. Triggered from the Feed page while the
 * user is viewing it, so that when they tap Explore the rails + artist cache
 * are already populated. Read-only from the client's POV — the response body
 * is just `{ ok: true }`; the value is the side-effect of populating
 * `explore_cache` and `artist_search_cache`.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  const [{ data: user, error: userError }, userAccessToken] = await Promise.all([
    supabase
      .from("users")
      .select("id, adventurous, underground_mode, popularity_curve, play_threshold")
      .eq("id", userId)
      .maybeSingle(),
    getAccessToken(req),
  ])
  if (userError || !user) return apiError("User not found", 404)

  const accessToken = userAccessToken ?? (await getSpotifyClientToken()) ?? ""

  try {
    await buildExploreRails(
      {
        userId: user.id,
        accessToken,
        adventurous: user.adventurous ?? false,
        undergroundMode: user.underground_mode ?? false,
        popularityCurve: typeof user.popularity_curve === "number" ? user.popularity_curve : undefined,
        playThreshold: typeof user.play_threshold === "number" ? user.play_threshold : undefined,
      },
      { hydrate: true },
    )
    return Response.json({ ok: true })
  } catch (err) {
    console.error("[explore/preload] fail", err instanceof Error ? err.message : err)
    return apiError("Preload failed", 500)
  }
}
