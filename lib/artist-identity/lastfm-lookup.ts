/**
 * The doorway's Last.fm lookup adapters, built on the Last.fm adapter
 * (`@/lib/lastfm`, which owns the HTTP, key, cache, gate and counters):
 * getInfo as the name resolver / enrichment.
 */
import type { Artist } from "@/lib/music-provider/types"
import { lastfm as defaultLastfm, type ArtistEnrichment, type Lastfm } from "@/lib/lastfm"

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
