import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import { buildExploreRails, type BuildRailsResult } from "@/lib/recommendation/explore-engine"
import type { NextRequest } from "next/server"

export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id

  const userAccessToken = await getAccessToken(req)
  const supabase = createServiceClient()

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, adventurous")
    .eq("id", userId)
    .maybeSingle()

  if (userError || !user) return apiError("User not found", 404)

  const accessToken = userAccessToken ?? (await getSpotifyClientToken()) ?? ""
  const force = req.nextUrl.searchParams.get("force") === "true"

  try {
    const result: BuildRailsResult = await buildExploreRails(
      {
        userId: user.id,
        accessToken,
        adventurous: user.adventurous ?? false,
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
