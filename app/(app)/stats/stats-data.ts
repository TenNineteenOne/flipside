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
  savedArtists: { name: string; popularity: number | null }[]
  likedArtists: { name: string; popularity: number | null }[]
}

/**
 * Everything /stats renders. Artist metadata (name, genres, popularity) comes
 * from `artists` by id (#175): `recommendation_cache` rows are hard-deleted by
 * the cron after ~33 days (and likes/saves from the retired Explore page never
 * wrote there), so reading
 * metadata from the cache emptied Top Genres and the taste profile over time.
 *
 * "Discovered" = distinct artists the user has met: seen Feed rows still in
 * the cache ∪ every feedback row (incl. un-thumbed) ∪ saves. Feedback and saves
 * are permanent, so the count no longer shrinks when the cron prunes old seen
 * rows.
 */
export async function loadStats(supabase: SupabaseClient, userId: string): Promise<StatsData> {
  const ids = (table: "recommendation_cache" | "saves", seenOnly = false) =>
    readAllRows<{ id: string; artist_id: string }>(() => {
      let q = supabase.from(table).select("id, artist_id").eq("user_id", userId)
      if (seenOnly) q = q.not("seen_at", "is", null)
      return q
    })

  // One feedback read (every row, incl. un-thumbed) feeds Discovered, the
  // like/dislike counts and the liked ids, instead of four separate reads.
  const [seenRows, feedbackRows, savedRows] = await Promise.all([
    ids("recommendation_cache", true),
    readAllRows<{ id: string; artist_id: string; signal: string; deleted_at: string | null }>(() =>
      supabase.from("feedback").select("id, artist_id, signal, deleted_at").eq("user_id", userId),
    ),
    ids("saves"),
  ])

  // A failed read must not render as a smaller number: throw to the (app) error boundary.
  const failed = [seenRows, feedbackRows, savedRows].find((r) => r.error)
  if (failed?.error) throw new Error(`[stats] read failed: ${failed.error.message}`)

  const live = feedbackRows.data.filter((r) => r.deleted_at == null)
  const likedRows = live.filter((r) => r.signal === "thumbs_up")
  const totalDislikes = live.filter((r) => r.signal === "thumbs_down").length

  const savedIds = new Set(savedRows.data.map((r) => r.artist_id))
  const likedIds = new Set(likedRows.map((r) => r.artist_id))
  const discovered = new Set([...seenRows.data, ...feedbackRows.data, ...savedRows.data].map((r) => r.artist_id))

  const artists = new Map<string, { name: string; genres: string[] | null; popularity: number | null }>()
  const allIds = Array.from(new Set([...savedIds, ...likedIds]))
  const chunks: string[][] = []
  for (let i = 0; i < allIds.length; i += IN_CHUNK) chunks.push(allIds.slice(i, i + IN_CHUNK))
  const reads = await Promise.all(
    chunks.map((chunk) => supabase.from("artists").select("id, name, genres, popularity").in("id", chunk)),
  )
  for (const { data, error } of reads) {
    if (error) throw new Error(`[stats] artists read failed: ${error.message}`)
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
    const item = { name: a.name, popularity: typeof a.popularity === "number" ? a.popularity : null }
    if (savedIds.has(id)) savedArtists.push(item)
    else likedArtists.push(item)
  }

  return {
    totalDiscovered: discovered.size,
    totalSaves: savedRows.data.length,
    totalLikes: likedRows.length,
    totalDislikes,
    topGenres,
    savedArtists,
    likedArtists,
  }
}
