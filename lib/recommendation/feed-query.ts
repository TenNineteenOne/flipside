import { createServiceClient } from "@/lib/supabase/server"
import { UNDERGROUND_MAX_POPULARITY } from "@/lib/recommendation/types"

export interface UnseenRecommendation {
  artist_id: string
  artist_data: unknown
  score: number
  why: unknown
  [key: string]: unknown
}

/**
 * Unseen (not-yet-shown, not-expired) recommendation_cache rows for `userId`,
 * re-filtered by the user's *current* underground_mode so toggling the
 * setting takes effect on first paint without requiring an explicit
 * regenerate. Overfetches 40 so filtering still leaves enough rows to fill
 * `limit`, then slices down to `limit`.
 *
 * `undergroundMode` is optional: callers that already hold the user row
 * (feed/page.tsx) pass it; callers that don't (the poll route) omit it and
 * the lookup runs here, in parallel with the cache fetch. A failed lookup
 * degrades to `false` (unfiltered) — same as the route's old behavior.
 */
export async function getUnseenRecommendations(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  { limit, undergroundMode }: { limit: number; undergroundMode?: boolean }
): Promise<UnseenRecommendation[]> {
  const [{ data, error }, userResult] = await Promise.all([
    supabase
      .from("recommendation_cache")
      .select("artist_id, artist_data, score, why, source, seen_at")
      .eq("user_id", userId)
      .is("seen_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("score", { ascending: false })
      .limit(40),
    undergroundMode === undefined
      ? supabase.from("users").select("underground_mode").eq("id", userId).maybeSingle()
      : Promise.resolve(null),
  ])

  if (error) throw error

  let mode = undergroundMode ?? false
  if (userResult) {
    if (userResult.error) {
      console.error("[recommendations/fetch] user lookup:", userResult.error.message)
    }
    mode = !!userResult.data?.underground_mode
  }

  let recommendations = (data ?? []) as UnseenRecommendation[]
  if (mode) {
    recommendations = recommendations.filter((r) => {
      const pop = (r.artist_data as { popularity?: number } | null)?.popularity
      return typeof pop !== "number" || pop <= UNDERGROUND_MAX_POPULARITY
    })
  }
  return recommendations.slice(0, limit)
}
