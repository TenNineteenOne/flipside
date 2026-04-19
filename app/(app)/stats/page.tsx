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
  const [seenResult, savesResult, likesResult, dislikesResult, genreResult, savedArtistRows] =
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

      supabase
        .from("saves")
        .select("spotify_artist_id")
        .eq("user_id", userId),
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

  // Resolve saved + liked artists → { name, popularity } via one recommendation_cache join
  const savedIds = Array.from(new Set((savedArtistRows.data ?? []).map((r) => r.spotify_artist_id)))
  const likedIds = Array.from(new Set(likedArtistIds))
  const savedSet = new Set(savedIds)
  const allIds = Array.from(new Set([...savedIds, ...likedIds]))

  const savedArtists: { name: string; popularity: number }[] = []
  const likedArtists: { name: string; popularity: number }[] = []

  if (allIds.length > 0) {
    const { data: cachedArtistData } = await supabase
      .from("recommendation_cache")
      .select("spotify_artist_id, artist_data")
      .eq("user_id", userId)
      .in("spotify_artist_id", allIds)

    const seen = new Set<string>()
    for (const row of cachedArtistData ?? []) {
      if (seen.has(row.spotify_artist_id)) continue
      seen.add(row.spotify_artist_id)
      const data = row.artist_data as { name?: string; popularity?: number } | null
      if (!data?.name) continue
      const pop = typeof data.popularity === "number" ? data.popularity : 0
      const item = { name: data.name, popularity: pop }
      if (savedSet.has(row.spotify_artist_id)) {
        savedArtists.push(item)
      } else {
        likedArtists.push(item)
      }
    }
  }

  return (
    <StatsClient
      totalDiscovered={seenResult.count ?? 0}
      totalSaves={savesResult.count ?? 0}
      totalLikes={likesResult.count ?? 0}
      totalDislikes={dislikesResult.count ?? 0}
      topGenres={topGenres}
      savedArtists={savedArtists}
      likedArtists={likedArtists}
    />
  )
}
