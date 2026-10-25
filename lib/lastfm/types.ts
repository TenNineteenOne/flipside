/** Shapes the Last.fm adapter returns (kept apart so `cache.ts` can type its payloads without importing the adapter). */

/** A similar-artist reference as returned by Last.fm's artist.getSimilar endpoint. */
export interface SimilarArtistRef {
  name: string
  /** Similarity score in [0, 1]. Parsed from Last.fm's `match` string. 0 when missing/unparseable. */
  match: number
}

/** artist.getInfo, translated: filtered genre tags + listener count scaled to 0-100. */
export interface ArtistEnrichment {
  genres: string[]
  popularity: number
}

/** One artist.search hit. */
export interface LastfmArtistCandidate {
  name: string
  mbid: string | null
  listeners: number
  imageUrl: string | null
}
