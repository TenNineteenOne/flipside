/**
 * Circuit breaker for preview-source HTTP calls (iTunes, Spotify).
 *
 * One instance per source. State is process-global (module-level singleton
 * per source), which is intentional: all concurrent requests for a given
 * source share the same budget so a burst cannot re-hammer a blocked
 * credential from multiple code paths.
 *
 * States:
 *   closed   — normal operation; failures accumulate a consecutive counter.
 *   open     — source is blocked; canRequest() returns false until cooldown
 *              elapses. openUntil() forces this with an explicit expiry so
 *              Spotify retry-after values are honoured exactly.
 *   half-open — cooldown elapsed; one probe request is allowed. On success
 *              the breaker closes; on failure it re-opens for another cycle.
 */

export interface BreakerOptions {
  /** Number of consecutive failures before tripping open. */
  failureThreshold: number
  /** How long (ms) to stay open before allowing a half-open probe. */
  cooldownMs: number
  /** Injectable clock — defaults to Date.now. Lets tests be deterministic. */
  now?: () => number
}

type BreakerState = "closed" | "open" | "half-open"

export class PreviewSourceBreaker {
  private readonly opts: Required<BreakerOptions>
  private failures = 0
  private openExpiry = 0 // 0 means not open

  constructor(opts: BreakerOptions) {
    this.opts = { now: Date.now, ...opts }
  }

  state(): BreakerState {
    if (this.openExpiry === 0) return "closed"
    if (this.opts.now() < this.openExpiry) return "open"
    return "half-open"
  }

  /**
   * Returns true when the breaker is closed or in half-open probe mode.
   * Returns false while open and the cooldown has not yet elapsed.
   */
  canRequest(): boolean {
    return this.state() !== "open"
  }

  /**
   * Call after a successful fetch. Closes the breaker and resets the
   * consecutive-failure counter regardless of current state.
   */
  recordSuccess(): void {
    this.failures = 0
    this.openExpiry = 0
  }

  /**
   * Call after any failed fetch (HTTP error or network throw).
   * Increments the consecutive-failure counter. When the count reaches
   * failureThreshold, trips the breaker open. In half-open state a single
   * failure immediately re-opens for another cooldown cycle.
   */
  recordFailure(): void {
    const s = this.state()
    if (s === "half-open") {
      // Re-open from the current moment for another full cooldown.
      this.openExpiry = this.opts.now() + this.opts.cooldownMs
      return
    }
    this.failures++
    if (this.failures >= this.opts.failureThreshold) {
      this.openExpiry = this.opts.now() + this.opts.cooldownMs
    }
  }

  /**
   * Force the breaker open until at least `timestampMs`.
   * Uses max(current expiry, timestampMs) so a longer provider-supplied
   * retry-after always wins over a shorter internal cooldown.
   *
   * Primary use: Spotify 429 with explicit Retry-After header.
   */
  openUntil(timestampMs: number): void {
    this.openExpiry = Math.max(this.openExpiry, timestampMs)
  }

  /**
   * How many milliseconds remain until the breaker can allow a probe.
   * Returns 0 when closed or half-open.
   */
  remainingMs(): number {
    if (this.openExpiry === 0) return 0
    return Math.max(0, this.openExpiry - this.opts.now())
  }
}
