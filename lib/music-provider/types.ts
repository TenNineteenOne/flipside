export interface Artist {
  id: string           // canonical artist identity — internal UUID (artists.id) after the Stage 2 cutover
  /**
   * Spotify artist id — an *attribute*, not the identity. Used only to talk to
   * the Spotify API and build Spotify links; null/undefined when unknown (e.g.
   * a Last.fm-only artist). Distinct from `id` (the internal UUID).
   */
  spotifyId?: string | null
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number   // 0-100
  /**
   * Confirmed playable preview tracks, baked in during resolution so the card
   * ships with its preview (no post-response race). Semantics:
   *   undefined → never preview-confirmed (resolve via iTunes/Spotify)
   *   []        → confirmed: no preview available (negative cache → drop)
   *   [..]      → confirmed playable tracks
   * Optional so legacy cache rows and metadata-only Artist constructions stay
   * valid; `ArtistWithTracks` narrows it to required for the scored pool.
   */
  topTracks?: Track[]
}

export interface Track {
  id: string                         // source-specific ID (iTunes trackId, Spotify id, …)
  spotifyTrackId: string | null      // null until JIT-resolved; set when the track is known on Spotify
  name: string
  previewUrl: string | null
  durationMs: number
  albumName: string
  albumImageUrl: string | null
  source: 'itunes' | 'spotify' | 'deezer'
}

export interface ArtistWithTracks extends Artist {
  topTracks: Track[]
}

export interface PlayHistory {
  artistId: string
  artistName: string
  playedAt: string  // ISO timestamp
}
