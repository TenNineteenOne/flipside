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
   * When present, callers should invoke this inside `after()` to resolve
   * the remaining candidate pool in the background. Adds more unseen recs
   * to `recommendation_cache` without blocking the initial response.
   */
  runSecondary: (() => Promise<number>) | null
  /**
   * Set when the pipeline auto-softened filters to avoid an empty pool.
   * `undefined` on normal (non-softened) runs.
   */
  softenedFilters?: SoftenedFilters
}
