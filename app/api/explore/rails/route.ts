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
import { safeAuth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiUnauthorized, apiError } from "@/lib/errors"
import { loadExploreInput } from "@/lib/explore-input"
import { buildExploreRails } from "@/lib/recommendation/explore-engine"
import { assembleRailPayloads } from "@/lib/recommendation/explore-rail-payloads"

export async function GET(): Promise<Response> {
  const session = await safeAuth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  const input = await loadExploreInput(supabase, userId)
  if (!input) return apiError("User not found", 404)

  try {
    // Read-only: never regenerate. Returns partial/empty rails when cold.
    const [buildResult, generatedAtResult] = await Promise.all([
      buildExploreRails(input, { hydrate: true, regenerate: false }),
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
