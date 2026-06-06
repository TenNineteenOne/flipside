/**
 * GET /api/explore/rails — read-only snapshot of the current Explore rails.
 *
 * Returns whatever is in `explore_cache` WITHOUT triggering a synchronous
 * regen (regenerate=false). Used by ExploreClient's poll-swap loop to detect
 * when a background regen (scheduled via POST /api/explore/generate?force=true)
 * has completed and new rails are ready to swap in.
 *
 * Response shape:
 *   { rails: RailPayload[], generatedAt: string | null }
 *
 * `generatedAt` is the MAX generated_at across the user's explore_cache rows.
 * The client compares this against the pre-regen snapshot; when it advances,
 * the regen is done.
 */
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiUnauthorized, apiError } from "@/lib/errors"
import { getAccessToken } from "@/lib/get-access-token"
import { getSpotifyClientToken } from "@/lib/spotify-client-token"
import { buildExploreRails } from "@/lib/recommendation/explore-engine"
import { assembleRailPayloads } from "@/lib/recommendation/explore-rail-payloads"
import type { NextRequest } from "next/server"

export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  const [{ data: user, error: userError }, userAccessToken, clientToken] = await Promise.all([
    supabase
      .from("users")
      .select("id, adventurous, underground_mode, popularity_curve, play_threshold")
      .eq("id", userId)
      .maybeSingle(),
    getAccessToken(req),
    getSpotifyClientToken(),
  ])

  if (userError || !user) return apiError("User not found", 404)

  const accessToken = userAccessToken ?? clientToken ?? ""

  try {
    // Read-only: never regenerate. Returns partial/empty rails when cold.
    const [buildResult, generatedAtResult] = await Promise.all([
      buildExploreRails(
        {
          userId: user.id,
          accessToken,
          adventurous: user.adventurous ?? false,
          undergroundMode: user.underground_mode ?? false,
          popularityCurve:
            typeof user.popularity_curve === "number" ? user.popularity_curve : undefined,
          playThreshold:
            typeof user.play_threshold === "number" ? user.play_threshold : undefined,
        },
        { hydrate: true, regenerate: false },
      ),
      supabase
        .from("explore_cache")
        .select("generated_at")
        .eq("user_id", userId)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const { rails, hydrated } = buildResult
    const artistById = hydrated ?? new Map()
    const payloads = assembleRailPayloads(rails, artistById)
    const generatedAt = (generatedAtResult.data?.generated_at as string | null) ?? null

    return Response.json({ rails: payloads, generatedAt })
  } catch (err) {
    console.error(
      "[explore/rails] fail",
      err instanceof Error ? err.message : err,
    )
    return apiError("Failed to read rails", 500)
  }
}
