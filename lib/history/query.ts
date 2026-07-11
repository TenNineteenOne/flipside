import { createServiceClient } from "@/lib/supabase/server"

export interface HistoryEntry {
  artist_id: string
  artist_data: {
    id: string
    name: string
    genres: string[]
    imageUrl: string | null
    popularity: number
  }
  score: number
  why: { sourceArtists: string[]; genres: string[]; friendBoost: string[] }
  artist_color: string | null
  seen_at: string
  signal: string
  bookmarked: boolean
}

/**
 * Seen recommendation_cache rows for `userId`, merged with feedback signal
 * and saves status.
 *
 * Fetches `limit + 1` rows so `hasMore` is exact at the boundary — a bare
 * `results.length === limit` heuristic reports hasMore=true even when the
 * page just returned was the last one, causing a spurious empty page
 * request from the client. See #C2 / app/api/history/route.ts history.
 *
 * Signal precedence: explicit feedback (thumbs_up/down) > permanent dismiss
 * (skip_at) > passive seen (skip). A user can't have both a feedback row and
 * a skip_at, but preferring feedback is the safe order.
 */
export async function getHistoryPage(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  { offset, limit }: { offset: number; limit: number }
): Promise<{ history: HistoryEntry[]; hasMore: boolean }> {
  const { data: seenRaw, error: seenErr } = await supabase
    .from("recommendation_cache")
    .select("artist_id, artist_data, score, why, seen_at, skip_at")
    .eq("user_id", userId)
    .not("seen_at", "is", null)
    .order("seen_at", { ascending: false })
    .range(offset, offset + limit)

  if (seenErr) throw seenErr

  const hasMore = (seenRaw ?? []).length > limit
  const seen = (seenRaw ?? []).slice(0, limit)
  const seenArtistIds = seen.map((r) => r.artist_id)

  if (seenArtistIds.length === 0) {
    return { history: [], hasMore: false }
  }

  const [{ data: feedback }, { data: saves }] = await Promise.all([
    supabase
      .from("feedback")
      .select("artist_id, signal")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("artist_id", seenArtistIds),
    supabase
      .from("saves")
      .select("artist_id")
      .eq("user_id", userId)
      .in("artist_id", seenArtistIds),
  ])

  const feedbackMap = new Map<string, string>()
  for (const f of feedback ?? []) {
    feedbackMap.set(f.artist_id, f.signal)
  }

  const savedSet = new Set((saves ?? []).map((s) => s.artist_id))

  const history = seen.map((rec) => {
    const feedbackSignal = feedbackMap.get(rec.artist_id as string)
    const signal = feedbackSignal
      ? feedbackSignal
      : rec.skip_at
        ? "dismissed"
        : "skip"
    return {
      artist_id: rec.artist_id,
      artist_data: rec.artist_data,
      score: rec.score,
      why: rec.why,
      artist_color: (rec.artist_data as Record<string, unknown>)?.artist_color as string | null ?? null,
      seen_at: rec.seen_at,
      signal,
      bookmarked: savedSet.has(rec.artist_id),
    } as HistoryEntry
  })

  return { history, hasMore }
}
