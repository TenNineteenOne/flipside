import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { HistoryClient } from "@/components/history/history-client"

export default async function HistoryPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()

  // 1. All seen recommendations
  const { data: seen } = await supabase
    .from("recommendation_cache")
    .select("spotify_artist_id, artist_data, score, why, seen_at, skip_at")
    .eq("user_id", userId)
    .not("seen_at", "is", null)
    .order("seen_at", { ascending: false })
    .limit(50)

  const seenArtistIds = (seen ?? []).map((r) => r.spotify_artist_id)

  // 2. Feedback and saves scoped to the seen artist IDs
  const [feedbackRes, savesRes] = await Promise.all([
    seenArtistIds.length > 0
      ? supabase
          .from("feedback")
          .select("spotify_artist_id, signal")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .in("spotify_artist_id", seenArtistIds)
      : Promise.resolve({ data: [] }),
    seenArtistIds.length > 0
      ? supabase
          .from("saves")
          .select("spotify_artist_id")
          .eq("user_id", userId)
          .in("spotify_artist_id", seenArtistIds)
      : Promise.resolve({ data: [] }),
  ])

  const feedbackMap = new Map<string, string>()
  for (const f of (feedbackRes.data ?? []) as { spotify_artist_id: string; signal: string }[]) {
    feedbackMap.set(f.spotify_artist_id, f.signal)
  }

  const savedSet = new Set(((savesRes.data ?? []) as { spotify_artist_id: string }[]).map((s) => s.spotify_artist_id))

  const history = (seen ?? []).map((rec) => {
    const feedbackSignal = feedbackMap.get(rec.spotify_artist_id)
    const signal = feedbackSignal
      ? feedbackSignal
      : rec.skip_at
        ? "dismissed"
        : "skip"
    return {
      spotify_artist_id: rec.spotify_artist_id,
      artist_data: rec.artist_data as {
        id: string
        name: string
        genres: string[]
        imageUrl: string | null
        popularity: number
      },
      score: rec.score as number,
      why: rec.why as { sourceArtists: string[]; genres: string[]; friendBoost: string[] },
      artist_color: (rec.artist_data as Record<string, unknown>).artist_color as string | null ?? null,
      seen_at: rec.seen_at as string,
      signal,
      bookmarked: savedSet.has(rec.spotify_artist_id),
    }
  })

  const hasMore = (seen ?? []).length === 50

  return <HistoryClient history={history} hasMore={hasMore} />
}
