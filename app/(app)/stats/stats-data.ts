import type { createServiceClient } from "@/lib/supabase/server"
import { readAllRows } from "@/lib/recommendation/exclusions"

type SupabaseClient = ReturnType<typeof createServiceClient>

/** PostgREST encodes `.in()` into the URL: keep id lists well under the 414 limit. */
const IN_CHUNK = 500

export interface StatsData {
  totalDiscovered: number
  totalSaves: number
  totalLikes: number
  totalDislikes: number
  topGenres: { genre: string; count: number }[]
  savedArtists: { name: string; popularity: number }[]
  likedArtists: { name: string; popularity: number }[]
}

/**
 * Everything /stats renders. Artist metadata (name, genres, popularity) comes
 * from `artists` by id (#175): `recommendation_cache` rows are hard-deleted by
 * the cron after ~33 days and Explore likes/saves never write there, so reading
 * metadata from the cache emptied Top Genres and the taste profile over time.
 *
 * "Discovered" = distinct artists the user has met: seen Feed rows still in
 * the cache ∪ every feedback row (incl. un-thumbed) ∪ saves. Feedback and saves
 * are permanent, so the count no longer shrinks when the cron prunes old seen
 * rows, and Explore discoveries the user acted on now count too.
 */
export async function loadStats(supabase: SupabaseClient, userId: string): Promise<StatsData> {
  const ids = (table: "recommendation_cache" | "feedback" | "saves", seenOnly = false) =>
    readAllRows<{ id: string; artist_id: string }>(() => {
      let q = supabase.from(table).select("id, artist_id").eq("user_id", userId)
      if (seenOnly) q = q.not("seen_at", "is", null)
      return q
    })

  const [seenRows, feedbackRows, likesResult, dislikesResult, likedRows, savedRows] = await Promise.all([
    ids("recommendation_cache", true),
    ids("feedback"),
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
    readAllRows<{ id: string; artist_id: string }>(() =>
      supabase
        .from("feedback")
        .select("id, artist_id")
        .eq("user_id", userId)
        .eq("signal", "thumbs_up")
        .is("deleted_at", null),
    ),
    ids("saves"),
  ])

  const savedIds = new Set(savedRows.data.map((r) => r.artist_id))
  const likedIds = new Set(likedRows.data.map((r) => r.artist_id))
  const discovered = new Set([...seenRows.data, ...feedbackRows.data, ...savedRows.data].map((r) => r.artist_id))

  const artists = new Map<string, { name: string; genres: string[] | null; popularity: number | null }>()
  const allIds = Array.from(new Set([...savedIds, ...likedIds]))
  const chunks: string[][] = []
  for (let i = 0; i < allIds.length; i += IN_CHUNK) chunks.push(allIds.slice(i, i + IN_CHUNK))
  const reads = await Promise.all(
    chunks.map((chunk) => supabase.from("artists").select("id, name, genres, popularity").in("id", chunk)),
  )
  for (const { data, error } of reads) {
    if (error) console.error(`[stats] artists-read-fail err=${error.message}`)
    for (const a of data ?? []) artists.set(a.id, a)
  }

  // Top genres: each liked artist counts once per genre it carries.
  const genreCounts = new Map<string, number>()
  for (const id of likedIds) {
    for (const genre of artists.get(id)?.genres ?? []) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
    }
  }
  const topGenres = Array.from(genreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, count]) => ({ genre, count }))

  // Taste profile: a saved artist is "saved" even if also liked.
  const savedArtists: StatsData["savedArtists"] = []
  const likedArtists: StatsData["likedArtists"] = []
  for (const id of allIds) {
    const a = artists.get(id)
    if (!a?.name) continue
    const item = { name: a.name, popularity: typeof a.popularity === "number" ? a.popularity : 0 }
    if (savedIds.has(id)) savedArtists.push(item)
    else likedArtists.push(item)
  }

  return {
    totalDiscovered: discovered.size,
    totalSaves: savedRows.data.length,
    totalLikes: likesResult.count ?? 0,
    totalDislikes: dislikesResult.count ?? 0,
    topGenres,
    savedArtists,
    likedArtists,
  }
}
