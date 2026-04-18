import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiUnauthorized, dbError } from "@/lib/errors"

/**
 * GET /api/history
 * Returns all recommendation_cache rows where seen_at IS NOT NULL,
 * joined with feedback signal and saves status.
 */
export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  // 1. All seen recommendations
  const { data: seen, error: seenErr } = await supabase
    .from("recommendation_cache")
    .select("spotify_artist_id, artist_data, score, why, artist_color, seen_at")
    .eq("user_id", userId)
    .not("seen_at", "is", null)
    .order("seen_at", { ascending: false })
    .limit(100)

  if (seenErr) return dbError(seenErr, "history/seen")

  // 2. All feedback rows for this user (non-deleted)
  const { data: feedback } = await supabase
    .from("feedback")
    .select("spotify_artist_id, signal")
    .eq("user_id", userId)
    .is("deleted_at", null)

  const feedbackMap = new Map<string, string>()
  for (const f of feedback ?? []) {
    feedbackMap.set(f.spotify_artist_id, f.signal)
  }

  // 3. All saved/bookmarked artist IDs
  const { data: saves } = await supabase
    .from("saves")
    .select("spotify_artist_id")
    .eq("user_id", userId)

  const savedSet = new Set((saves ?? []).map((s) => s.spotify_artist_id))

  // 4. Merge into a single response
  const history = (seen ?? []).map((rec) => ({
    spotify_artist_id: rec.spotify_artist_id,
    artist_data: rec.artist_data,
    score: rec.score,
    why: rec.why,
    artist_color: rec.artist_color,
    seen_at: rec.seen_at,
    signal: feedbackMap.get(rec.spotify_artist_id) ?? "skip",
    bookmarked: savedSet.has(rec.spotify_artist_id),
  }))

  return Response.json({ history })
}
