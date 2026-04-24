import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { getAccessToken } from "@/lib/get-access-token"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import { buildExploreRails, type BuildRailsResult } from "@/lib/recommendation/explore-engine"
import type { NextRequest } from "next/server"

export async function POST(req: NextRequest): Promise<Response> {
  const blocked = enforceSameOrigin(req)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  const supabase = createServiceClient()

  const [userAccessToken, clientToken, { data: user, error: userError }] = await Promise.all([
    getAccessToken(req),
    getSpotifyClientToken(),
    supabase
      .from("users")
      .select("id, adventurous, underground_mode, popularity_curve, play_threshold")
      .eq("id", userId)
      .maybeSingle(),
  ])

  if (userError || !user) return apiError("User not found", 404)

  const accessToken = userAccessToken ?? clientToken ?? ""
  const force = req.nextUrl.searchParams.get("force") === "true"

  try {
    const result: BuildRailsResult = await buildExploreRails(
      {
        userId: user.id,
        accessToken,
        adventurous: user.adventurous ?? false,
        undergroundMode: user.underground_mode ?? false,
        popularityCurve: typeof user.popularity_curve === "number" ? user.popularity_curve : undefined,
        playThreshold: typeof user.play_threshold === "number" ? user.play_threshold : undefined,
      },
      { force },
    )
    return Response.json({
      success: true,
      cacheHit: result.cacheHit,
      rails: result.rails.map((r) => ({ railKey: r.railKey, count: r.artistIds.length })),
    })
  } catch (err) {
    console.error("[explore/generate] fail", err instanceof Error ? err.message : err)
    return apiError("Explore generation failed", 500)
  }
}
