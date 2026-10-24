/**
 * Generic outbound-call limiter: optional token bucket (sustained rate),
 * optional minimum interval between dispatches, and a concurrency cap.
 * Process-wide instances are built per upstream (`lib/lastfm-limit.ts`,
 * `lib/itunes-limit.ts`). Wrap ONLY the network fetch so cache hits pay nothing.
 */

/**
 * A classic token bucket. Pure and deterministic: every method takes the
 * current time so it can be unit-tested synchronously without timers. Tokens
 * refill continuously at `ratePerSec` up to `capacity`.
 */
export class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(
    private readonly capacity: number,
    private readonly ratePerSec: number,
    private readonly clock: () => number = Date.now,
  ) {
    this.tokens = capacity
    this.lastRefill = clock()
  }

  private refill(now: number): void {
    if (now > this.lastRefill) {
      const added = ((now - this.lastRefill) / 1000) * this.ratePerSec
      this.tokens = Math.min(this.capacity, this.tokens + added)
      this.lastRefill = now
    }
  }

  /** Consume one token if available. Returns true on success. */
  tryConsume(now: number = this.clock()): boolean {
    this.refill(now)
    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }
    return false
  }

  /** Milliseconds until at least one token is available (0 if available now). */
  msUntilNext(now: number = this.clock()): number {
    this.refill(now)
    if (this.tokens >= 1) return 0
    return Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000)
  }
}

export interface CreateLimiterOptions {
  /** Max simultaneous in-flight calls. */
  maxConcurrency: number
  /** Token bucket bounding the sustained rate. Omit for no rate bound. */
  bucket?: { capacity: number; ratePerSec: number }
  /** Minimum gap (ms) between successive dispatches. Omit for none. */
  minIntervalMs?: number
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number
  /** Injectable sleep. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>
}

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function createLimiter(opts: CreateLimiterOptions): Limiter {
  const { maxConcurrency, minIntervalMs } = opts
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? realSleep

  const bucket = opts.bucket ? new TokenBucket(opts.bucket.capacity, opts.bucket.ratePerSec, now) : null

  // Serialize token acquisition so waiters are admitted FIFO and the bucket is
  // checked one-at-a-time (no thundering herd waking to race for a single
  // token). Each acquirer waits for the prior to finish consuming, then drains
  // the bucket, sleeping for the exact deficit when empty.
  let tail: Promise<void> = Promise.resolve()

  async function acquireToken(): Promise<void> {
    if (!bucket) return
    const prior = tail
    let signalDone!: () => void
    tail = new Promise<void>((resolve) => (signalDone = resolve))
    await prior
    try {
      while (!bucket.tryConsume()) {
        await sleep(bucket.msUntilNext())
      }
    } finally {
      signalDone()
    }
  }

  // Min-interval gate (the iTunes #142 semantics, preserved exactly): wait until
  // the earliest allowed dispatch, then push it `minIntervalMs` past now.
  // ponytail: callers arriving in the same tick all see the same deadline and
  // dispatch together after one wait (the concurrency cap still bounds them).
  // Reserve per-caller slots (at = max(now, next); next = at + gap) if a strict
  // spacing is ever needed — that changes iTunes burst timing, so measure first.
  let nextDispatchAt = 0

  async function awaitInterval(): Promise<void> {
    if (!minIntervalMs) return
    const wait = nextDispatchAt - now()
    if (wait > 0) await sleep(wait)
    nextDispatchAt = Math.max(now(), nextDispatchAt) + minIntervalMs
  }

  // Concurrency gate: a slot is transferred to the next waiter on release
  // (active stays put), so `active` never exceeds maxConcurrency.
  let active = 0
  const slotWaiters: Array<() => void> = []

  function acquireSlot(): Promise<void> {
    if (active < maxConcurrency) {
      active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => slotWaiters.push(resolve))
  }

  function releaseSlot(): void {
    const next = slotWaiters.shift()
    if (next) next()
    else active--
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquireToken()
      await awaitInterval()
      await acquireSlot()
      try {
        return await fn()
      } finally {
        releaseSlot()
      }
    },
  }
}
