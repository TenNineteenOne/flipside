import type { Artist, Track } from "@/lib/music-provider/types"
import type { RateLimited } from "@/lib/music-provider"
import { isRateLimited } from "@/lib/music-provider"
import type { ArtistNameCache } from "./artist-name-cache"
import { mergeEnrichment, type ArtistEnrichment } from "./enrich-artist"

export interface ResolveDeps {
  cache: Pick<ArtistNameCache, "batchRead" | "write">
  /**
   * Live Spotify search. Returns the artist array on success, an empty
   * array on no-match, or a `RateLimited` sentinel on 429.
   */
  searchArtists: (name: string) => Promise<Artist[] | RateLimited>
  /**
   * Optional enrichment — called by name in parallel with the Spotify
   * search and merged into the resolved Artist before the cache write.
   * Fills `genres` + `popularity` since Spotify's /search endpoint returns
   * neither. A null result is survivable: the cache write still happens
   * with whatever Spotify returned.
   */
  enrichArtist?: (name: string) => Promise<ArtistEnrichment | null>
  /**
   * Optional preview confirmation. When provided, every resolved artist (cache
   * hit AND live miss) is run through this to attach its playable `topTracks`;
   * artists that confirm empty are DROPPED from `resolved` (the playability
   * guarantee). The fn reuses `artist.topTracks` when already present (warm
   * cache → no network). Freshly-confirmed artists are written back to the
   * name cache WITH their `topTracks` so the name cache doubles as the preview
   * cache. Never throws — a failure degrades to "drop".
   */
  confirmPreview?: (artist: Artist) => Promise<Track[]>
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
  /** Artists dropped because no playable preview was found (confirmPreview only). */
  droppedNoPreview: number
  /** Wall-clock of the preview-confirmation pass in ms (0 when confirmPreview absent). */
  previewMs: number
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
    droppedNoPreview: 0,
    previewMs: 0,
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
        resolvedArtist = res.find((a) => a.name.toLowerCase() === lower) ?? res[0]
        break
      }

      if (resolvedArtist) {
        const enrichment = await enrichmentPromise
        resolvedArtist = mergeEnrichment(resolvedArtist, enrichment)
        result.searchOk++
        result.resolved.set(name, resolvedArtist)
        // When confirmPreview is active the confirmation pass writes back the
        // artist WITH its topTracks (so the name cache carries the preview);
        // skip the bare write here to avoid a redundant double-upsert.
        if (!deps.confirmPreview) await deps.cache.write(name, resolvedArtist)
        firstSuccessfulSearch = false
      } else {
        // Avoid unhandled-rejection warnings on the enrichment promise.
        void enrichmentPromise.catch(() => {})
        result.searchFail++
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, runWorker))

  // Preview-confirmation pass (opt-in). Runs over EVERY resolved artist — cache
  // hits and live misses alike — because the playability guarantee must hold for
  // both, and the hit path never reaches the miss worker. Each artist's
  // playable tracks are attached; artists with none are dropped. Concurrency is
  // bounded downstream by the shared iTunes limiter, so a flat Promise.all here
  // can't out-burst the API; warm artists (topTracks already cached) resolve
  // with no network and make this pass effectively free.
  if (deps.confirmPreview) {
    const confirm = deps.confirmPreview
    const previewStart = Date.now()
    const entries = [...result.resolved.entries()]
    await Promise.all(
      entries.map(async ([name, art]) => {
        const fresh = art.topTracks === undefined
        let tracks: Track[]
        try {
          tracks = await confirm(art)
        } catch {
          tracks = []
        }
        const withTracks: Artist = { ...art, topTracks: tracks }
        // Persist freshly-confirmed artists (positive OR negative/empty) into the
        // name cache so the next encounter is a warm, network-free hit.
        if (fresh) await deps.cache.write(name, withTracks)
        if (tracks.length === 0) {
          result.resolved.delete(name)
          result.droppedNoPreview++
        } else {
          result.resolved.set(name, withTracks)
        }
      })
    )
    result.previewMs = Date.now() - previewStart
  }

  return result
}
