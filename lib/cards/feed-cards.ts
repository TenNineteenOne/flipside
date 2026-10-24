import type { createServiceClient } from "@/lib/supabase/server"
import type { Track } from "@/lib/music-provider/types"
import { hasPlayablePreview } from "@/lib/recommendation/confirm-previews"
import type { UnseenRecommendation } from "@/lib/recommendation/feed-query"
import { liftArtistColor, type CardArtist } from "@/lib/cards/card-artist"

type ArtistDataRow = {
  id?: string
  spotifyId?: string | null
  name?: string
  genres?: string[]
  imageUrl?: string | null
  popularity?: number
  topTracks?: Track[]
}

/** Rows missing essential artist data are never rendered. */
export function isRenderableRow(row: UnseenRecommendation): boolean {
  const a = row.artist_data as ArtistDataRow | null | undefined
  return !!(a?.id && a?.name)
}

/** Round-robin interleave by primary source artist so results aren't clustered. */
export function interleave(cards: CardArtist[]): CardArtist[] {
  const buckets = new Map<string, CardArtist[]>()
  for (const card of cards) {
    const key = card.why.sourceArtists[0] ?? "__none"
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(card)
  }
  const groups = Array.from(buckets.values())
  const out: CardArtist[] = []
  let i = 0
  while (out.length < cards.length) {
    const g = groups[i % groups.length]
    if (g.length > 0) out.push(g.shift()!)
    i++
    if (groups.every((g) => g.length === 0)) break
  }
  return out
}

/**
 * Pure feed-card assembler. From unseen recommendation_cache rows (+ the
 * artist_tracks_cache rows for them, keyed by artist_id):
 *   1. drop rows missing artist id/name,
 *   2. prefer previews baked into artist_data (#134), fall back to the tracks
 *      cache for legacy rows written before the bake,
 *   3. lift `artist_data.artist_color` to `artistColor`,
 *   4. drop cards with no playable preview (never render a dead card),
 *   5. interleave by primary source artist.
 *
 * Interleave is per call (one page of ≤20 rows). The feed's append-poller
 * dedupes each page against what's already shown, so appended cards keep the
 * page's interleaved relative order; interleaving across the append boundary
 * would mean reordering cards already on screen, which the feed never does.
 */
export function assembleFeedCards(
  rows: UnseenRecommendation[],
  tracksByArtistId: Map<string, Track[]>,
): CardArtist[] {
  const cards: CardArtist[] = []
  for (const row of rows) {
    if (!isRenderableRow(row)) continue
    const a = row.artist_data as ArtistDataRow
    const why = (row.why ?? {}) as { sourceArtists?: string[]; genres?: string[] }
    const baked = a.topTracks
    const topTracks = baked && baked.length > 0 ? baked : tracksByArtistId.get(row.artist_id) ?? []
    if (!hasPlayablePreview(topTracks)) continue
    cards.push({
      id: row.artist_id,
      spotifyId: a.spotifyId ?? null,
      name: a.name!,
      genres: a.genres ?? [],
      imageUrl: a.imageUrl ?? null,
      popularity: a.popularity ?? 0,
      topTracks,
      artistColor: liftArtistColor(a),
      why: { sourceArtists: why.sourceArtists ?? [], genres: why.genres ?? [] },
    })
  }
  return interleave(cards)
}

/**
 * Load the tracks-cache fallback for `rows` and assemble feed cards. Shared by
 * the feed page (first paint) and GET /api/recommendations (append poll) so
 * both paint identical cards.
 */
export async function loadFeedCards(
  supabase: ReturnType<typeof createServiceClient>,
  rows: UnseenRecommendation[],
): Promise<CardArtist[]> {
  const renderable = rows.filter(isRenderableRow)
  if (renderable.length === 0) return []
  const { data } = await supabase
    .from("artist_tracks_cache")
    .select("artist_id, tracks")
    .in("artist_id", renderable.map((r) => r.artist_id))
  const tracksByArtistId = new Map<string, Track[]>()
  for (const row of data ?? []) {
    tracksByArtistId.set(row.artist_id, (row.tracks as Track[]) ?? [])
  }
  return assembleFeedCards(renderable, tracksByArtistId)
}
