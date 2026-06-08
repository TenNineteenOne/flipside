import { after } from "next/server"
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
      .select("id, adventurous, underground_mode, popularity_curve, play_threshold, last_explore_generated_at")
      .eq("id", userId)
      .maybeSingle(),
  ])

  if (userError || !user) return apiError("User not found", 404)

  const accessToken = userAccessToken ?? clientToken ?? ""
  const force = req.nextUrl.searchParams.get("force") === "true"

  const railInput = {
    userId: user.id,
    accessToken,
    adventurous: user.adventurous ?? false,
    undergroundMode: user.underground_mode ?? false,
    popularityCurve: typeof user.popularity_curve === "number" ? user.popularity_curve : undefined,
    playThreshold: typeof user.play_threshold === "number" ? user.play_threshold : undefined,
  }

  if (force) {
    // Per-user cooldown on the expensive (54-74s) rebuild. Window is longer than
    // the build itself so a second force can't schedule an overlapping build, and
    // it caps how fast the shared Spotify/Last.fm key can be burned by repeated
    // force-regens. Mirrors recommendations/generate's last_generated_at gate.
    const FORCE_COOLDOWN_MS = 90_000
    if (user.last_explore_generated_at) {
      const elapsed = Date.now() - new Date(user.last_explore_generated_at).getTime()
      if (elapsed < FORCE_COOLDOWN_MS) {
        return apiError("Explore is already refreshing — please wait a moment", 429)
      }
    }
    // Stamp the cooldown BEFORE scheduling so two rapid taps can't both pass the gate.
    await supabase
      .from("users")
      .update({ last_explore_generated_at: new Date().toISOString() })
      .eq("id", userId)

    // Non-blocking force-regen (#145a): schedule the 54-74s build to run after
    // the response is sent so the Shuffle / Settings-regenerate path returns
    // immediately. The cache write still completes; the client picks up fresh
    // rails on next render (live poll-swap is #145b).
    after(async () => {
      try {
        await buildExploreRails(railInput, { force: true })
      } catch (err) {
        console.error("[explore/generate] background regen failed", err instanceof Error ? err.message : err)
      }
    })
    return Response.json({ success: true, regenerating: true })
  }

  // Warm-cache / non-force path: synchronous as before (fast cache read).
  try {
    const result: BuildRailsResult = await buildExploreRails(railInput, { force: false })
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
