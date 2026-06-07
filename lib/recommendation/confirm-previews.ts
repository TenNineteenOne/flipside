import type { Artist, Track } from "@/lib/music-provider/types"

/** Tracks with a real preview URL — the only ones that can actually play. */
export function playableTracks(tracks: Track[]): Track[] {
  return tracks.filter((t) => t.previewUrl != null && t.previewUrl !== "")
}

/**
 * Read-path guard: true when an artist has at least one playable preview. Used
 * by the feed and explore read paths to never render a dead card — a last line
 * of defense over the drop-at-write guarantee (catches legacy rows written
 * before previews were baked). Accepts the minimal `{ previewUrl }` shape so it
 * works on both `Track[]` and the leaner cached card shapes.
 */
export function hasPlayablePreview(
  tracks: ReadonlyArray<{ previewUrl: string | null }> | null | undefined
): boolean {
  return !!tracks && tracks.some((t) => t.previewUrl != null && t.previewUrl !== "")
}

export interface ConfirmPreviewDeps {
  /** iTunes search by artist name. Returns tracks, [] for no match, or null on failure. */
  searchItunes: (name: string) => Promise<Track[] | null>
  /** Spotify top-tracks by artist id. Returns tracks ([] on none/failure). Fallback source. */
  getSpotifyTopTracks: (artistId: string) => Promise<Track[]>
}

export interface ConfirmInput {
  id: string
  name: string
  /**
   * Previously-confirmed tracks from the name cache (artist_data.topTracks).
   *  - undefined  → never confirmed: resolve via iTunes/Spotify
   *  - []         → confirmed-no-preview (negative cache): reuse, returns []
   *  - [..]       → confirmed: reuse (filtered to playable)
   */
  topTracks?: Track[]
}

/**
 * Walk a score-ordered list of items, calling `confirm` for each artist.
 * Keeps items whose confirm returns ≥1 playable track, baking `topTracks`
 * onto a copy of the item. Stops as soon as `kept.length === target` —
 * the tail is never confirmed. Errors from `confirm` are treated as "no
 * tracks" (skip, not throw). Returns `kept` (order-preserving) and the
 * total number of `confirm` calls made (`confirmedCount`).
 *
 * Confirms in bounded concurrent waves (each wave sized to the remaining
 * need, capped at `batchSize`) rather than one-at-a-time: this preserves
 * the stop-at-target / order-preserving contract while letting per-wave
 * calls run in parallel. Real concurrency is further bounded downstream by
 * the iTunes limiter — the wave just keeps its slots full instead of idling
 * between sequential awaits, which is what makes the confirm stage fast
 * enough for the first-paint budget.
 */
export async function confirmToTarget<T extends { artist: Artist }>(
  items: T[],
  target: number,
  confirm: (artist: Artist) => Promise<Track[]>,
  batchSize = 8,
): Promise<{ kept: T[]; confirmedCount: number }> {
  const kept: T[] = []
  let confirmedCount = 0
  let i = 0

  while (i < items.length && kept.length < target) {
    const need = target - kept.length
    const wave = items.slice(i, i + Math.min(batchSize, need))
    i += wave.length
    confirmedCount += wave.length

    const results = await Promise.all(
      wave.map(async (item) => {
        try {
          return await confirm(item.artist)
        } catch {
          return [] as Track[]
        }
      }),
    )

    for (let w = 0; w < wave.length; w++) {
      if (kept.length >= target) break
      const tracks = results[w]
      if (tracks.length > 0) {
        kept.push({ ...wave[w], artist: { ...wave[w].artist, topTracks: tracks } })
      }
    }
  }

  return { kept, confirmedCount }
}

/**
 * Confirm an artist's playable tracks. Reuses cached topTracks when present
 * (no network); otherwise iTunes-first, Spotify fallback. Returns ONLY playable
 * tracks (non-null previewUrl); an empty result means "drop this artist".
 * NEVER throws — any source failure degrades to the next source / empty.
 */
export async function confirmPlayableTracks(
  artist: ConfirmInput,
  deps: ConfirmPreviewDeps,
): Promise<Track[]> {
  // 1. Cache reuse — covers positive AND negative cache (empty array included)
  if (artist.topTracks !== undefined) {
    return playableTracks(artist.topTracks)
  }

  // 2. iTunes-first
  const it = await deps.searchItunes(artist.name).catch(() => null)
  const p = playableTracks(it ?? [])
  if (p.length > 0) return p

  // 3. Spotify fallback
  const sp = await deps.getSpotifyTopTracks(artist.id).catch(() => [])
  const p2 = playableTracks(sp)
  if (p2.length > 0) return p2

  // 4. Nothing found
  return []
}
