/**
 * The doorway's Last.fm lookup adapters, built on the Last.fm adapter
 * (`@/lib/lastfm`, which owns the HTTP, key, cache, gate and counters):
 * getInfo as the name resolver / enrichment, and the artist.search match guard.
 */
import type { Artist } from "@/lib/music-provider/types"
import { lastfm as defaultLastfm, type ArtistEnrichment, type Lastfm, type LastfmArtistCandidate } from "@/lib/lastfm"
import { artistNameKey, stringSimilarity, SIMILARITY_THRESHOLD } from "./name-key"

/**
 * Merge enrichment data into an artist record. Non-destructive: only fills
 * fields left empty (forward-compatible if a source ever returns real genres).
 */
export function mergeEnrichment(artist: Artist, enrichment: ArtistEnrichment | null): Artist {
  if (!enrichment) return artist
  return {
    ...artist,
    genres: artist.genres.length > 0 ? artist.genres : enrichment.genres,
    popularity: artist.popularity > 0 ? artist.popularity : enrichment.popularity,
  }
}

/**
 * The live `enrichArtist` dep for resolve-candidates (Last.fm getInfo, cached).
 * Returns undefined when the key is missing — callers feature-detect rather
 * than noop.
 */
export function buildEnrichArtist(lf: Lastfm = defaultLastfm) {
  if (!lf.hasKey()) return undefined
  return (name: string) => lf.artistInfo(name)
}

/**
 * Spotify-free name resolver (Stage 2, #157): the `searchArtists` dep for
 * resolve-candidates, wired to Last.fm artist.getInfo — the SAME cached call
 * `buildEnrichArtist` uses, so it adds ~0 extra network. Returns one Artist
 * carrying getInfo's genres/popularity, or [] for a genuine not-found.
 *
 *  - `id: ""` — the canonical uuid is minted downstream (ArtistIdentity.ensure).
 *  - `spotifyId: null` — Last.fm has no Spotify id; the #159 worker backfills it.
 *  - `imageUrl: null` — getInfo's image is a placeholder.
 *
 * Never rate-limits (the Last.fm gate paces it), so never a RateLimited sentinel.
 */
export function lastfmResolve(name: string, lf: Lastfm = defaultLastfm): Promise<Artist[]> {
  if (!lf.hasKey()) return Promise.resolve([])
  return lf.artistInfo(name).then((e) =>
    e
      ? [{ id: "", spotifyId: null, name, genres: e.genres, popularity: e.popularity, imageUrl: null }]
      : [],
  )
}

export interface ArtistSearchMatch {
  /** Canonical artist name as Last.fm spells it. */
  name: string
  mbid: string | null
  imageUrl: string | null
  listeners: number
  /** Name-similarity to the query; 1 for an exact normalized match. */
  similarity: number
}

function toMatch(c: LastfmArtistCandidate, similarity: number): ArtistSearchMatch {
  return { name: c.name, mbid: c.mbid, imageUrl: c.imageUrl, listeners: c.listeners, similarity }
}

/**
 * Choose the confident match for `query` among Last.fm search `candidates`, or null.
 *
 * 1. Exact normalized-name match wins (scanned across ALL candidates, since
 *    Last.fm may rank a more-popular fuzzy hit above the exact one). This also
 *    covers short names, which `stringSimilarity` scores 0 for length < 2.
 * 2. Otherwise the highest name-similarity candidate, accepted only if it
 *    clears SIMILARITY_THRESHOLD. Below threshold → null (logged, never cached
 *    as a resolution) so a disambiguation error can't poison the shared cache.
 */
export function pickBestMatch(query: string, candidates: LastfmArtistCandidate[]): ArtistSearchMatch | null {
  if (candidates.length === 0) return null
  const nq = artistNameKey(query)

  const exact = candidates.find((c) => artistNameKey(c.name) === nq)
  if (exact) return toMatch(exact, 1)

  let best: LastfmArtistCandidate | null = null
  let bestSim = 0
  for (const c of candidates) {
    const sim = stringSimilarity(query, c.name)
    if (sim > bestSim) {
      bestSim = sim
      best = c
    }
  }
  if (best && bestSim >= SIMILARITY_THRESHOLD) return toMatch(best, bestSim)

  console.log(
    `[lfm-search] no confident match for "${query}" ` +
      `(best="${best?.name ?? "-"}" sim=${bestSim.toFixed(2)} < ${SIMILARITY_THRESHOLD})`,
  )
  return null
}

/** Search + similarity guard: the confidently-matched artist, or null. */
export async function searchAndMatchArtist(query: string, lf: Lastfm = defaultLastfm): Promise<ArtistSearchMatch | null> {
  return pickBestMatch(query, await lf.searchArtists(query))
}
