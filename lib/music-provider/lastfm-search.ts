/**
 * Last.fm artist-search provider (#154).
 *
 * Maps a Last.fm `artist.search` response to artist candidates and picks a
 * confident match: an exact (normalized) name match is preferred; otherwise the
 * best candidate by name-similarity, but ONLY if it clears SIMILARITY_THRESHOLD.
 * Below threshold we return no match — so a Last.fm disambiguation error can't
 * poison the shared cross-user resolve cache.
 *
 * This is the keyless replacement for Spotify artist search. In Stage 1 it backs
 * the onboarding typeahead (#156); the live generation resolver keeps using
 * Spotify search until the Stage-2 surrogate-UUID identity cut (#157), because
 * `spotify_artist_id` is still the load-bearing NOT-NULL key until then.
 *
 * Live calls route through the shared Last.fm limiter (#150) and the read-through
 * search cache (#149); the per-endpoint `search` counter (#148) ticks on each
 * live call.
 */
import { runLastfm } from "@/lib/lastfm-limit"
import { cachedArtistSearch } from "@/lib/lastfm-cache"
import { incLastfmSearch } from "@/lib/recommendation/api-call-counter"
import { stringSimilarity, normalizeArtistName, SIMILARITY_THRESHOLD } from "@/lib/history/name-utils"

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0"
const TIMEOUT_MS = 8000
const SEARCH_LIMIT = 10

export interface LastfmArtistCandidate {
  name: string
  mbid: string | null
  listeners: number
  imageUrl: string | null
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

interface RawLastfmArtist {
  name?: string
  mbid?: string
  listeners?: string
  image?: Array<{ "#text"?: string; size?: string }>
}

/** Pick the largest non-empty image URL Last.fm returned, or null. */
function pickImage(images?: Array<{ "#text"?: string; size?: string }>): string | null {
  if (!Array.isArray(images)) return null
  const bySize = (s: string) => images.find((i) => i.size === s)?.["#text"]
  const url =
    bySize("extralarge") ||
    bySize("large") ||
    bySize("medium") ||
    images.map((i) => i["#text"]).find((t) => t && t.length > 0)
  return url && url.length > 0 ? url : null
}

/**
 * Map a raw Last.fm artist.search JSON body to candidates. Tolerates the Last.fm
 * quirk where a single result is an object rather than an array, and missing
 * fields. Returns [] for a no-results / malformed body.
 */
export function mapSearchResponse(data: unknown): LastfmArtistCandidate[] {
  const raw = (data as { results?: { artistmatches?: { artist?: unknown } } })?.results?.artistmatches
    ?.artist
  const arr: RawLastfmArtist[] = Array.isArray(raw)
    ? (raw as RawLastfmArtist[])
    : raw
      ? [raw as RawLastfmArtist]
      : []
  return arr
    .filter((a): a is RawLastfmArtist => typeof a?.name === "string" && a.name.length > 0)
    .map((a) => ({
      name: a.name as string,
      mbid: typeof a.mbid === "string" && a.mbid.length > 0 ? a.mbid : null,
      listeners: Number.parseInt(a.listeners ?? "0", 10) || 0,
      imageUrl: pickImage(a.image),
    }))
}

function toMatch(c: LastfmArtistCandidate, similarity: number): ArtistSearchMatch {
  return { name: c.name, mbid: c.mbid, imageUrl: c.imageUrl, listeners: c.listeners, similarity }
}

/**
 * Choose the confident match for `query` among `candidates`, or null.
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
  const nq = normalizeArtistName(query)

  const exact = candidates.find((c) => normalizeArtistName(c.name) === nq)
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

/** Single live Last.fm artist.search. Throws on transient failure so it isn't cached. */
async function fetchSearchCandidatesRaw(query: string, limit: number): Promise<LastfmArtistCandidate[]> {
  const apiKey = process.env.LASTFM_API_KEY
  if (!apiKey) return []
  const url =
    `${LASTFM_BASE}/?method=artist.search&artist=${encodeURIComponent(query)}` +
    `&api_key=${apiKey}&format=json&limit=${limit}`
  return runLastfm(async () => {
    incLastfmSearch()
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`lastfm artist.search ${res.status}`)
    const data = (await res.json()) as { error?: number }
    if (data.error) throw new Error(`lastfm artist.search error ${data.error}`)
    return mapSearchResponse(data)
  })
}

/**
 * Cached Last.fm artist search → ranked candidates (read-through, 7-day TTL,
 * empty results negative-cached on the short TTL). Empty query short-circuits.
 */
export async function searchArtistCandidates(
  query: string,
  limit: number = SEARCH_LIMIT,
): Promise<LastfmArtistCandidate[]> {
  const q = query.trim()
  if (q.length === 0) return []
  return cachedArtistSearch<LastfmArtistCandidate>(q, limit, fetchSearchCandidatesRaw)
}

/**
 * Search + similarity guard. Returns the confidently-matched artist, or null
 * when nothing clears the threshold (so callers don't resolve/cache a wrong
 * artist).
 */
export async function searchAndMatchArtist(query: string): Promise<ArtistSearchMatch | null> {
  const candidates = await searchArtistCandidates(query)
  return pickBestMatch(query, candidates)
}
