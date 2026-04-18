import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiUnauthorized, dbError } from "@/lib/errors"
import { type NextRequest } from "next/server"

/**
 * GET /api/history
 * Returns recommendation_cache rows where seen_at IS NOT NULL,
 * joined with feedback signal and saves status.
 * Supports pagination via `offset` and `limit` query params.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const supabase = createServiceClient()

  const url = new URL(request.url)
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0)
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50))

  // 1. Paginated seen recommendations
  const { data: seen, error: seenErr } = await supabase
    .from("recommendation_cache")
    .select("spotify_artist_id, artist_data, score, why, seen_at")
    .eq("user_id", userId)
    .not("seen_at", "is", null)
    .order("seen_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (seenErr) return dbError(seenErr, "history/seen")

  const seenArtistIds = (seen ?? []).map((r) => r.spotify_artist_id)

  if (seenArtistIds.length === 0) {
    return Response.json({ history: [], hasMore: false })
  }

  // 2. Feedback + saves scoped to only the returned artist IDs
  const [{ data: feedback }, { data: saves }] = await Promise.all([
    supabase
      .from("feedback")
      .select("spotify_artist_id, signal")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("spotify_artist_id", seenArtistIds),
    supabase
      .from("saves")
      .select("spotify_artist_id")
      .eq("user_id", userId)
      .in("spotify_artist_id", seenArtistIds),
  ])

  const feedbackMap = new Map<string, string>()
  for (const f of feedback ?? []) {
    feedbackMap.set(f.spotify_artist_id, f.signal)
  }

  const savedSet = new Set((saves ?? []).map((s) => s.spotify_artist_id))

  // 3. Merge into a single response
  const history = (seen ?? []).map((rec) => ({
    spotify_artist_id: rec.spotify_artist_id,
    artist_data: rec.artist_data,
    score: rec.score,
    why: rec.why,
    artist_color: (rec.artist_data as Record<string, unknown>)?.artist_color as string | null ?? null,
    seen_at: rec.seen_at,
    signal: feedbackMap.get(rec.spotify_artist_id) ?? "skip",
    bookmarked: savedSet.has(rec.spotify_artist_id),
  }))

  return Response.json({ history, hasMore: seenArtistIds.length === limit })
}
