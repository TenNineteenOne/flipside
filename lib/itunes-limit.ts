/**
 * Process-wide concurrency gate for live iTunes network calls.
 *
 * iTunes is hit from three directions simultaneously: the blocking-set preview
 * confirmation (one call per card in the initial feed), the four Explore rails
 * (each fires per-artist track lookups in parallel), and the per-artist tracks
 * endpoint used in the detail view. Without a shared gate these can fire 20-50
 * simultaneous requests, which causes iTunes to slow-lane or throttle the burst.
 *
 * Cap reduced from 12 → 5 (issue #142) to reduce the chance of an IP-level
 * 403 during preview fan-out. A 50ms minimum gap between successive dispatches
 * spreads the burst across time instead of firing 5 back-to-back instantly.
 *
 * The gate wraps ONLY the network fetch — cache hits (and all pure in-process
 * filtering/dedup logic) never reach it, so warm reads pay zero overhead.
 *
 * Shared across all iTunes callers so concurrent rails and the blocking set
 * can't collectively out-burst the API.
 */
import { createLimiter } from "@/lib/limiter"

const MAX_CONCURRENCY = 5
const MIN_INTERVAL_MS = 50 // minimum ms between successive dispatches

const limiter = createLimiter({ maxConcurrency: MAX_CONCURRENCY, minIntervalMs: MIN_INTERVAL_MS })

/**
 * Run `fn` under the shared iTunes concurrency cap and min-interval gate.
 * Callers outside lib/music-provider/itunes.ts should use `itunesFetch`, which
 * adds the circuit breaker and call counter on top of this gate.
 */
export function runItunes<T>(fn: () => Promise<T>): Promise<T> {
  return limiter.run(fn)
}
