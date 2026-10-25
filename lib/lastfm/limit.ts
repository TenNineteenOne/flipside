/**
 * Process-wide rate + concurrency limiter for live Last.fm network calls.
 *
 * Last.fm rate-limits per originating IP (~5 req/s averaged); a cold generation
 * burst (the Left-field rail's leaf-tag sample + similar/getInfo resolution) can
 * fire far more than that at once. This limiter enforces TWO bounds so Last.fm
 * doesn't become the new single point of failure now that #149 caching shifted
 * load onto it:
 *
 *   1. Token bucket (runaway-guard ceiling: ~20 req/s sustained, ~50 burst) — caps
 *      the sustained OUTBOUND request rate. This is the new control added in #150.
 *   2. Concurrency cap (≤12 in-flight) — caps simultaneous open sockets, so a
 *      slow endpoint can't accumulate unbounded in-flight requests. (Earlier
 *      finding: bounding the leaf-tag burst to ≤12 concurrent kept calls under
 *      ~1s vs multi-second stalls when firing ~34 at once.)
 *
 * ALL live Last.fm fetchers route through this limiter: tag.gettopartists,
 * artist.getSimilar, artist.getInfo (enrichment), and artist.search when #154
 * lands. getInfo is the dominant live endpoint, so gating it here is what makes
 * the rate cap actually bound a generation burst (it previously bypassed the
 * gate entirely). The limiter only wraps the *network* fetch — cache hits never
 * reach it, so it adds no latency on warm reads.
 *
 * Per-process is acceptable at pre-release scale; a true per-IP/distributed
 * limiter is deferred (single Vercel region, low concurrency).
 */

import { createLimiter, type Limiter } from "@/lib/limiter"

export { TokenBucket } from "@/lib/limiter"

/**
 * Sustained outbound rate, requests/second. Tuned (#150) as a RUNAWAY-GUARD, not
 * a tight shaper: the concurrency cap below is the real in-the-moment protection;
 * this rate is set high enough that normal generations don't throttle but a
 * runaway loop still can't hammer Last.fm. Measured basis: at 10/s a 220-call
 * generation incurred ~8s of throttle wait (~19%); 20/s + 50 burst clears that
 * (peak arrival ~5/s, well under the ceiling). Last.fm's real limit is a 5-min
 * AVERAGE of ~5/s, and at pre-release scale (sparse generations) the average sits
 * ~2/s — so in-burst headroom is large. RATCHET this DOWN toward ~5/s as the user
 * base grows and 5-minute averages rise (and as #151 pre-warm cuts live calls).
 */
const RATE_PER_SEC = 20
/** Bucket capacity — the largest instantaneous burst allowed before throttling. */
const BUCKET_CAPACITY = 50
/** Max simultaneous in-flight Last.fm fetches. */
const MAX_CONCURRENCY = 12

export interface LimiterOptions {
  capacity?: number
  ratePerSec?: number
  maxConcurrency?: number
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number
  /** Injectable sleep. Defaults to setTimeout. Tests pass a clock-advancing stub. */
  sleep?: (ms: number) => Promise<void>
}

export type LastfmLimiter = Limiter

/**
 * Build a Last.fm limiter instance (token bucket + concurrency cap, via the
 * shared `createLimiter`). Production uses a single shared instance (exported
 * as `runLastfm`); tests build their own with a fake clock + sleep so rate
 * assertions are deterministic and instant.
 */
export function createLastfmLimiter(opts: LimiterOptions = {}): LastfmLimiter {
  return createLimiter({
    bucket: {
      capacity: opts.capacity ?? BUCKET_CAPACITY,
      ratePerSec: opts.ratePerSec ?? RATE_PER_SEC,
    },
    maxConcurrency: opts.maxConcurrency ?? MAX_CONCURRENCY,
    now: opts.now,
    sleep: opts.sleep,
  })
}

/** Shared production limiter. */
const defaultLimiter = createLastfmLimiter()

/** Run `fn` under the shared Last.fm rate + concurrency limiter. */
export function runLastfm<T>(fn: () => Promise<T>): Promise<T> {
  return defaultLimiter.run(fn)
}
