import { createServiceClient } from "@/lib/supabase/server"

/** Minimum unseen recs below which we consider the feed "empty". */
const MIN_FRESH = 5

/**
 * Returns true if the user has at least MIN_FRESH unseen, non-expired
 * recommendations in their cache. Used by the splash page to decide whether
 * to redirect straight to /feed or show the "Find me music" button.
 */
export async function hasFreshRecs(userId: string): Promise<boolean> {
  const supabase = createServiceClient()
  const { count } = await supabase
    .from("recommendation_cache")
    .select("spotify_artist_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("seen_at", null)
    .gt("expires_at", new Date().toISOString())

  return (count ?? 0) >= MIN_FRESH
}
