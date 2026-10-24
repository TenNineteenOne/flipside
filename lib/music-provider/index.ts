import { Artist, ArtistWithTracks, Track } from "./types"

export type { Artist, ArtistWithTracks, Track }

/** Sentinel returned by rate-limited calls. */
export interface RateLimited {
  rateLimited: true
  /** Value of the Spotify `Retry-After` header in seconds (default 10). */
  retryAfterSec: number
  /**
   * Set when the limit is reported by an OPEN circuit breaker (not a live 429).
   * The caller should NOT retry/back off — the circuit is open for every call,
   * so retrying just burns the shared backoff budget against a closed door.
   * Skip immediately and move on.
   */
  skipRetry?: boolean
}

export function isRateLimited(x: unknown): x is RateLimited {
  return typeof x === "object" && x !== null && (x as RateLimited).rateLimited === true
}
