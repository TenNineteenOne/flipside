import type { Artist } from "@/lib/music-provider/types"
import type { RateLimited } from "@/lib/music-provider"
import { isRateLimited } from "@/lib/music-provider"
import type { ArtistNameCache } from "./artist-name-cache"

export interface ResolveDeps {
  cache: Pick<ArtistNameCache, "batchRead" | "write">
  /**
   * Live Spotify search. Returns the artist array on success, an empty
   * array on no-match, or a `RateLimited` sentinel on 429.
   */
  searchArtists: (name: string) => Promise<Artist[] | RateLimited>
  /** Delay between successful searches (ms). Default 2000. Pass 0 in tests. */
  delayMs?: number
  /** Max single-retry backoff (ms). Default 20_000. */
  maxRetryBackoffMs?: number
  /** Total backoff budget across all names (ms). Default 90_000. */
  totalBackoffBudgetMs?: number
  /** Max attempts per name (initial + retries). Default 3. */
  maxAttemptsPerName?: number
  sleep?: (ms: number) => Promise<void>
}

export interface ResolveResult {
  /** Resolved artists keyed by the original (unlowered) input name. */
  resolved: Map<string, Artist>
  cacheHits: number
  cacheMisses: number
  searchOk: number
  searchFail: number
  searchRetries: number
  /** True if we ever saw a 429 during the run. */
  rateLimited: boolean
  /** True if we stopped backing off because the total budget was exhausted. */
  backoffBudgetExhausted: boolean
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Resolve a list of artist names to Spotify Artist objects, cache-first.
 *
 * On a 429 for a given name, backs off (honoring Spotify's `Retry-After`,
 * capped at `maxRetryBackoffMs`) and retries up to `maxAttemptsPerName`
 * times. If all attempts still fail, **skips the name and continues** to
 * the next one — Spotify rate limits are short-windowed and later calls
 * frequently succeed.
 *
 * Bounded by `totalBackoffBudgetMs` across the whole run: once exceeded,
 * subsequent 429s are not waited out (we still attempt the call, but do
 * not sleep before it).
 *
 * Pure: no Supabase, no Spotify, no env access — all I/O is on `deps`.
 */
export async function resolveArtistsByName(
  names: string[],
  deps: ResolveDeps
): Promise<ResolveResult> {
  const sleep = deps.sleep ?? defaultSleep
  const delayMs = deps.delayMs ?? 2000
  const maxRetryBackoffMs = deps.maxRetryBackoffMs ?? 20_000
  const totalBackoffBudgetMs = deps.totalBackoffBudgetMs ?? 90_000
  const maxAttempts = deps.maxAttemptsPerName ?? 3

  const result: ResolveResult = {
    resolved: new Map(),
    cacheHits: 0,
    cacheMisses: 0,
    searchOk: 0,
    searchFail: 0,
    searchRetries: 0,
    rateLimited: false,
    backoffBudgetExhausted: false,
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

  let spentBackoffMs = 0
  let firstSuccessfulSearch = true

  for (const name of misses) {
    // Polite delay between successful live searches (skip before the first)
    if (!firstSuccessfulSearch) {
      await sleep(delayMs)
    }

    let attempt = 0
    let resolvedArtist: Artist | null = null
    let exhaustedForThisName = false

    while (attempt < maxAttempts) {
      attempt++
      const res = await deps.searchArtists(name)

      if (isRateLimited(res)) {
        result.rateLimited = true
        if (attempt >= maxAttempts) {
          exhaustedForThisName = true
          break
        }
        result.searchRetries++
        const budgetLeft = totalBackoffBudgetMs - spentBackoffMs
        if (budgetLeft <= 0) {
          result.backoffBudgetExhausted = true
          // No more waiting — try next name immediately
          exhaustedForThisName = true
          break
        }
        const requested = Math.max(1, res.retryAfterSec) * 1000
        const waitMs = Math.min(requested, maxRetryBackoffMs, budgetLeft)
        await sleep(waitMs)
        spentBackoffMs += waitMs
        continue
      }

      // Not rate limited — it's an array
      if (res.length === 0) {
        // No match for this name
        break
      }

      const lower = name.toLowerCase()
      resolvedArtist = res.find((a) => a.name.toLowerCase() === lower) ?? res[0]
      break
    }

    if (resolvedArtist) {
      result.searchOk++
      result.resolved.set(name, resolvedArtist)
      await deps.cache.write(name, resolvedArtist)
      firstSuccessfulSearch = false
    } else {
      result.searchFail++
      if (exhaustedForThisName) {
        // Counted as fail above; keep looping to try next name
      }
    }
  }

  return result
}
