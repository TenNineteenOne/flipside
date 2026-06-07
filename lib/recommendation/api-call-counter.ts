/**
 * Process-global API call instrumentation for iTunes and Spotify.
 *
 * Counters are module-level (singleton). Concurrent generations interleave
 * their counts, which is acceptable: the per-user 30 s cooldown makes
 * concurrent same-process generations rare in practice, and these counters
 * are a measurement aid — not business logic.
 *
 * Usage pattern in a generation request:
 *   resetCalls()              // just before buildRecommendations()
 *   await buildRecommendations(...)
 *   const calls = snapshotCalls()  // just before logging gen-timing
 */

let itunesCount = 0
let spotifyCount = 0

/** Increment the iTunes outbound-request counter by 1. */
export function incItunes(): void {
  itunesCount++
}

/** Increment the Spotify outbound-request counter by 1. */
export function incSpotify(): void {
  spotifyCount++
}

/** Return current totals without resetting. */
export function snapshotCalls(): { itunes: number; spotify: number } {
  return { itunes: itunesCount, spotify: spotifyCount }
}

/** Reset both counters to 0. Call immediately before a generation run. */
export function resetCalls(): void {
  itunesCount = 0
  spotifyCount = 0
}
