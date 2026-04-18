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
    .select("spotify_artist_id, artist_data, score, why, artist_color, seen_at")
    .eq("user_id", userId)
    .not("seen_at", "is", null)
    .order("seen_at", { ascending: false })
    .limit(100)

  // 2. All feedback rows
  const { data: feedback } = await supabase
    .from("feedback")
    .select("spotify_artist_id, signal")
    .eq("user_id", userId)
    .is("deleted_at", null)

  const feedbackMap = new Map<string, string>()
  for (const f of feedback ?? []) {
    feedbackMap.set(f.spotify_artist_id, f.signal)
  }

  // 3. All saved/bookmarked
  const { data: saves } = await supabase
    .from("saves")
    .select("spotify_artist_id")
    .eq("user_id", userId)

  const savedSet = new Set((saves ?? []).map((s) => s.spotify_artist_id))

  const history = (seen ?? []).map((rec) => ({
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
    artist_color: rec.artist_color as string | null,
    seen_at: rec.seen_at as string,
    signal: feedbackMap.get(rec.spotify_artist_id) ?? "skip",
    bookmarked: savedSet.has(rec.spotify_artist_id),
  }))

  return <HistoryClient history={history} />
}
