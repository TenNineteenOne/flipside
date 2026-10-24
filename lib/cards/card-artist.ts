import type { ArtistWithTracks } from "@/lib/music-provider/types"

/**
 * The one shape every artist card renders from (Feed, Explore). Built
 * server-side by the assemblers (`lib/cards/feed-cards.ts` for Feed,
 * `lib/recommendation/explore-rail-payloads.ts` for Explore) and passed
 * straight to `ArtistCard` — no client-side adapters.
 *
 * `id` is the internal artist UUID (= recommendation_cache.artist_id /
 * artists.id).
 */
export interface CardArtist extends ArtistWithTracks {
  /**
   * Stored colour exactly as persisted (may be null, invalid or the
   * `#8b5cf6` sentinel). Resolve for display with `resolveArtistColor`.
   */
  artistColor: string | null
  /** Why this card was picked. Empty arrays when there's no provenance. */
  why: CardWhy
}

export interface CardWhy {
  sourceArtists: string[]
  genres: string[]
}

/**
 * Lift the extracted colour out of a recommendation_cache `artist_data` blob
 * (written there by POST /api/recommendations/generate). null when absent.
 */
export function liftArtistColor(artistData: unknown): string | null {
  const c = (artistData as { artist_color?: unknown } | null | undefined)?.artist_color
  return typeof c === "string" ? c : null
}
