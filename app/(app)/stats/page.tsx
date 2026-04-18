import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { StatsClient } from "@/components/stats/stats-client"

export default async function StatsPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  const userId = session.user.id
  const supabase = createServiceClient()

  // Run all queries in parallel
  const [seenResult, savesResult, likesResult, dislikesResult, genreResult] =
    await Promise.all([
      supabase
        .from("recommendation_cache")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("seen_at", "is", null),

      supabase
        .from("saves")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),

      supabase
        .from("feedback")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("signal", "thumbs_up")
        .is("deleted_at", null),

      supabase
        .from("feedback")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("signal", "thumbs_down")
        .is("deleted_at", null),

      supabase
        .from("feedback")
        .select("spotify_artist_id")
        .eq("user_id", userId)
        .eq("signal", "thumbs_up")
        .is("deleted_at", null),
    ])

  // Build top genres from liked artists
  const topGenres: { genre: string; count: number }[] = []
  const likedArtistIds = (genreResult.data ?? []).map((f) => f.spotify_artist_id)

  if (likedArtistIds.length > 0) {
    const { data: cacheRows } = await supabase
      .from("recommendation_cache")
      .select("artist_data")
      .eq("user_id", userId)
      .in("spotify_artist_id", likedArtistIds)

    const genreCounts = new Map<string, number>()
    for (const row of cacheRows ?? []) {
      const data = row.artist_data as { genres?: string[] } | null
      for (const genre of data?.genres ?? []) {
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
      }
    }

    const sorted = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    for (const [genre, count] of sorted) {
      topGenres.push({ genre, count })
    }
  }

  return (
    <StatsClient
      totalDiscovered={seenResult.count ?? 0}
      totalSaves={savesResult.count ?? 0}
      totalLikes={likesResult.count ?? 0}
      totalDislikes={dislikesResult.count ?? 0}
      topGenres={topGenres}
    />
  )
}
