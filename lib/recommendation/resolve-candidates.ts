import type { Artist } from "@/lib/music-provider/types"
import type { RateLimited } from "@/lib/music-provider"
import { isRateLimited } from "@/lib/music-provider"
import type { ArtistNameCache } from "./artist-name-cache"
import { mergeEnrichment, type ArtistEnrichment } from "./enrich-artist"
import { stringSimilarity } from "@/lib/history/name-utils"

/** Min Dice-coefficient name similarity to accept a fuzzy (non-exact) Spotify result. */
const FUZZY_ACCEPT_THRESHOLD = 0.8

export interface ResolveDeps {
  cache: Pick<ArtistNameCache, "batchRead" | "write">
  /**
   * Provider-agnostic name resolver. Returns the artist array on success, an
   * empty array on no-match, or a `RateLimited` sentinel on 429. Wired to
   * Last.fm artist.getInfo in Stage 2 (#157) so generation is Spotify-free; the
   * adapter is responsible for setting `.spotifyId` on each result (null for
   * Last.fm-resolved artists). A `RateLimited` return is still honored for any
   * future rate-limiting provider.
   */
  searchArtists: (name: string) => Promise<Artist[] | RateLimited>
  /**
   * Mint/resolve the canonical `artists.id` (uuid) for a resolved artist. The
   * caller wires this to `ensureArtist(serviceClient, …)`, which dedups on
   * spotify_id when the artist carries one, else get-or-creates by name.
   * Returns the uuid, or null when minting failed (e.g. DB unavailable) — in
   * which case the resolver SKIPS caching that name rather than persist a
   * non-uuid `.id` as the identity. Optional: when omitted (legacy/tests) the
   * resolved result is used as-is and `.id` is left untouched.
   */
  mintArtist?: (artist: Artist) => Promise<string | null>
  /**
   * Optional enrichment — called by name in parallel with the Spotify
   * search and merged into the resolved Artist before the cache write.
   * Fills `genres` + `popularity` since Spotify's /search endpoint returns
   * neither. A null result is survivable: the cache write still happens
   * with whatever Spotify returned.
   */
  enrichArtist?: (name: string) => Promise<ArtistEnrichment | null>
  /** Delay between successful searches (ms). Default 200. Pass 0 in tests. */
  delayMs?: number
  /** Max single-retry backoff (ms). Default 20_000. */
  maxRetryBackoffMs?: number
  /** Total backoff budget across all names (ms). Default 90_000. */
  totalBackoffBudgetMs?: number
  /** Max attempts per name (initial + retries). Default 3. */
  maxAttemptsPerName?: number
  /** Number of parallel miss-resolver workers. Default 4. */
  concurrency?: number
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
  const delayMs = deps.delayMs ?? 200
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

  // Shared budget across workers; reserved synchronously before each sleep
  // so concurrent workers see the updated value and don't double-spend.
  let spentBackoffMs = 0

  const queue = [...misses]
  const concurrency = Math.max(1, Math.min(deps.concurrency ?? 4, queue.length))

  async function runWorker() {
    let firstSuccessfulSearch = true

    while (queue.length > 0) {
      const name = queue.shift()
      if (name === undefined) return

      // Polite delay between this worker's successful live searches.
      if (!firstSuccessfulSearch) {
        await sleep(delayMs)
      }

      // Fire enrichment in parallel with Spotify search. The Spotify retry
      // loop below may take multiple round-trips; enrichment resolves
      // (or fails silently) in the background either way.
      const enrichmentPromise: Promise<ArtistEnrichment | null> = deps.enrichArtist
        ? deps.enrichArtist(name).catch(() => null)
        : Promise.resolve(null)

      let attempt = 0
      let resolvedArtist: Artist | null = null

      while (attempt < maxAttempts) {
        attempt++
        const res = await deps.searchArtists(name)

        if (isRateLimited(res)) {
          result.rateLimited = true
          // Open circuit breaker: every call is short-circuited, so retrying
          // just drains the shared backoff budget against a closed door. Skip
          // this name immediately and let the worker move on.
          if (res.skipRetry) break
          if (attempt >= maxAttempts) break
          result.searchRetries++
          const budgetLeft = totalBackoffBudgetMs - spentBackoffMs
          if (budgetLeft <= 0) {
            result.backoffBudgetExhausted = true
            break
          }
          // Guard against undefined / NaN retryAfterSec — `Math.max(1, undefined)`
          // returns NaN, which propagates through the sleep and defeats backoff.
          const retryAfterSec = typeof res.retryAfterSec === "number" && Number.isFinite(res.retryAfterSec)
            ? res.retryAfterSec
            : 10
          const requested = Math.max(1, retryAfterSec) * 1000
          const waitMs = Math.min(requested, maxRetryBackoffMs, budgetLeft)
          // Reserve before sleeping so concurrent workers see the updated budget
          spentBackoffMs += waitMs
          await sleep(waitMs)
          continue
        }

        if (res.length === 0) break

        const lower = name.toLowerCase()
        const exact = res.find((a) => a.name.toLowerCase() === lower)
        if (exact) {
          // Exact lowercased-name match — accept unconditionally.
          resolvedArtist = exact
        } else {
          // No exact match: only accept the top result as a fuzzy fallback when
          // its name is similar enough. A weak fallback (Spotify returning an
          // unrelated artist for a misspelled / non-Spotify name) would mint a
          // wrong identity and poison the cache, so we'd rather no-resolve.
          const candidate = res[0]
          if (stringSimilarity(name, candidate.name) >= FUZZY_ACCEPT_THRESHOLD) {
            resolvedArtist = candidate
          }
        }
        break
      }

      if (resolvedArtist) {
        const enrichment = await enrichmentPromise
        resolvedArtist = mergeEnrichment(resolvedArtist, enrichment)

        // Mint the canonical uuid identity. Provider-agnostic: the search
        // adapter already set `.spotifyId` correctly (the Last.fm adapter sets
        // it to null; a Spotify adapter would set the real Spotify id), so we
        // ONLY assign the minted uuid to `.id` — we never derive `.spotifyId`
        // from `.id` here.
        if (deps.mintArtist) {
          const uuid = await deps.mintArtist(resolvedArtist)
          if (uuid) {
            resolvedArtist = { ...resolvedArtist, id: uuid }
            result.searchOk++
            result.resolved.set(name, resolvedArtist)
            await deps.cache.write(name, resolvedArtist)
            firstSuccessfulSearch = false
          } else {
            // Mint failed (e.g. DB unavailable). We must NEVER let a non-uuid id
            // leak downstream as the artist identity — recommendation_cache /
            // explore now key on artists.id (a uuid FK), so a placeholder `.id`
            // would either violate the FK or poison dedup. Drop the name: skip
            // both the resolved map and the cache write, count as a fail.
            result.searchFail++
          }
        } else {
          result.searchOk++
          result.resolved.set(name, resolvedArtist)
          await deps.cache.write(name, resolvedArtist)
          firstSuccessfulSearch = false
        }
      } else {
        // Avoid unhandled-rejection warnings on the enrichment promise.
        void enrichmentPromise.catch(() => {})
        result.searchFail++
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, runWorker))

  return result
}
