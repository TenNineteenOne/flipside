import type { ArtistWithTracks } from '../music-provider/types'

export interface RecommendationInput {
  userId: string        // Supabase UUID
  accessToken: string   // Spotify access token (empty string if user has no Spotify)
  playThreshold: number // from users.play_threshold
  popularityCurve: number // from users.popularity_curve — base `k` of k^popularity scoring
  genre?: string        // optional genre filter for targeted generation
  undergroundMode?: boolean // when true, applies additional discoveryScore penalty
  deepDiscovery?: boolean   // when true, take a 2nd-hop walk from each seed's lowest-match similars
  adventurous?: boolean     // when true, broadens For You (more adjacent bleed, softer mainstream-seed penalty)
}

/**
 * Surfaced alongside a BuildResult when we auto-softened filters because the
 * normal pipeline produced an empty pool. The client shows a matching toast
 * so the user knows the feed was widened for this batch.
 */
export interface SoftenedFilters {
  playThreshold: boolean
  coldStart: boolean
}

export interface ScoredArtist {
  artist: ArtistWithTracks
  score: number
  why: { sourceArtists: string[]; genres: string[]; friendBoost: string[] }
  source: string
}

/**
 * When `undergroundMode` is on, any candidate whose Spotify `popularity` is
 * strictly greater than this value is hard-dropped from the pool. Shared with
 * the settings curve preview so the UI cliff tracks the engine filter.
 */
export const UNDERGROUND_MAX_POPULARITY = 50

export interface BuildResult {
  count: number
  /**
   * True when background work remains (the tier-2 + secondary confirm/write
   * pass); false only when the pipeline failed early (empty pool).
   */
  pending: boolean
  /**
   * The one background continuation. Callers invoke it inside `after()`. It
   * finishes the feed (tier-2 to target, then the secondary pool — only for
   * the returned run) and THEN persists every run's confirmed previews to
   * `artist_tracks_cache` (#162), including earlier soften runs'. The flush
   * runs even if the secondary pass throws; the error is rethrown after.
   */
  finish: () => Promise<void>
  /**
   * Set when the pipeline auto-softened filters to avoid an empty pool.
   * `undefined` on normal (non-softened) runs.
   */
  softenedFilters?: SoftenedFilters
  metrics: {
    primaryMs: number
    /** Wall-clock of the tier-1 (first-batch) confirm pass (ms). Equals time user waited for first paint. */
    previewMs: number
    /** Wall-clock of the tier-1 confirm pass — same value as previewMs, surfaced separately for gen-timing. */
    firstBatchMs: number
    misses: number
    retries: number
    rateLimited: boolean
  }
}
