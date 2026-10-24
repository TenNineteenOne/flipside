import { after } from "next/server"
import { apiError } from "@/lib/errors"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"
import { loadExploreInput } from "@/lib/explore-input"
import { claimCooldown } from "@/lib/cooldown"
import { buildExploreRails, type BuildRailsResult } from "@/lib/recommendation/explore-engine"
import type { NextRequest } from "next/server"

// The warm-cache/non-force path can still fall through to a cold-cache
// 54-74s rail build; give it the full Hobby/Fluid function budget (F-hardening).
export const maxDuration = 300

export const POST = withAuthedCsrfRoute(async ({ userId, request, supabase }): Promise<Response> => {
  const req = request as NextRequest
  const railInput = await loadExploreInput(supabase, userId)
  if (!railInput) return apiError("User not found", 404)

  const force = req.nextUrl.searchParams.get("force") === "true"

  if (force) {
    // Per-user cooldown on the expensive (54-74s) rebuild. Window is longer than
    // the build itself so a second force can't schedule an overlapping build, and
    // it caps how fast the shared Spotify/Last.fm key can be burned by repeated
    // force-regens. Mirrors recommendations/generate's last_generated_at gate.
    // The claim stamps the cooldown atomically BEFORE scheduling, so two rapid
    // taps can't both pass the gate.
    const FORCE_COOLDOWN_MS = 90_000
    if ((await claimCooldown(supabase, userId, "last_explore_generated_at", FORCE_COOLDOWN_MS)) === "cooling") {
      return apiError("Explore is already refreshing — please wait a moment", 429)
    }

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
})
