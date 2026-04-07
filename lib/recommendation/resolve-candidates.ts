import type { Artist } from "@/lib/music-provider/types"
import type { ArtistNameCache } from "./artist-name-cache"

export interface ResolveDeps {
  cache: Pick<ArtistNameCache, "batchRead" | "write">
  /** Live Spotify search. Returns null on rate-limit (429), [] on no match. */
  searchArtists: (name: string) => Promise<Artist[] | null>
  /** Delay between live searches (ms). Default 2000. Pass 0 in tests. */
  delayMs?: number
  /** Backoff after a 429 before single retry (ms). Default 35000. */
  backoffMs?: number
  sleep?: (ms: number) => Promise<void>
}

export interface ResolveResult {
  /** Resolved artists keyed by the original (unlowered) input name. */
  resolved: Map<string, Artist>
  cacheHits: number
  cacheMisses: number
  searchOk: number
  searchFail: number
  rateLimited: boolean
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Resolve a list of artist names to Spotify Artist objects, cache-first.
 *
 * Order of operations:
 * 1. Batch-read all names from the cache in one query.
 * 2. For each cache miss, perform a live Spotify search (delayed, sequential).
 * 3. Persist successful live results back to the cache.
 * 4. On a 429, wait `backoffMs` and retry the *current* name once. If that
 *    also 429s, abort the remaining live searches (cache hits already in hand
 *    are still returned).
 *
 * Pure: no Supabase, no Spotify, no env access — all I/O is on `deps`.
 */
export async function resolveArtistsByName(
  names: string[],
  deps: ResolveDeps
): Promise<ResolveResult> {
  const sleep = deps.sleep ?? defaultSleep
  const delayMs = deps.delayMs ?? 2000
  const backoffMs = deps.backoffMs ?? 35000

  const result: ResolveResult = {
    resolved: new Map(),
    cacheHits: 0,
    cacheMisses: 0,
    searchOk: 0,
    searchFail: 0,
    rateLimited: false,
  }

  if (names.length === 0) return result

  const cached = await deps.cache.batchRead(names)

  const misses: string[] = []
  for (const name of names) {
    const hit = cached.get(name.toLowerCase())
    if (hit) {
      result.resolved.set(name, hit)
      result.cacheHits++
    } else {
      misses.push(name)
    }
  }
  result.cacheMisses = misses.length

  for (const name of misses) {
    await sleep(delayMs)
    let results = await deps.searchArtists(name)

    if (results === null) {
      // 429 — back off and retry this name once.
      result.searchFail++
      if (result.rateLimited) break
      result.rateLimited = true
      await sleep(backoffMs)
      results = await deps.searchArtists(name)
      if (results === null) break
      // retry succeeded — fall through to process `results`
      result.searchFail-- // un-count, we recovered
    }

    if (!results.length) {
      result.searchFail++
      continue
    }

    const lower = name.toLowerCase()
    const artist = results.find((a) => a.name.toLowerCase() === lower) ?? results[0]
    result.searchOk++
    result.resolved.set(name, artist)
    await deps.cache.write(name, artist)
  }

  return result
}
