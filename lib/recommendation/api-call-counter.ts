/**
 * Process-global API call instrumentation for iTunes, Spotify, and Last.fm.
 *
 * Counters are module-level (singleton). Concurrent generations interleave
 * their counts, which is acceptable: the per-user 30 s cooldown makes
 * concurrent same-process generations rare in practice, and these counters
 * are a measurement aid — not business logic.
 *
 * Last.fm counts are split per endpoint (similar / getInfo / tag / search) so
 * the gen-timing log shows exactly how many LIVE calls hit each endpoint. This
 * is the measurement gate for the Spotify-independence effort (#147): cache
 * hits must NOT increment — only the actual outbound HTTP fetch does.
 *
 * Usage pattern in a generation request:
 *   resetCalls()              // just before buildRecommendations()
 *   await buildRecommendations(...)
 *   const calls = snapshotCalls()  // just before logging gen-timing
 */

let itunesCount = 0
let spotifyCount = 0
let lastfmSimilarCount = 0
let lastfmGetInfoCount = 0
let lastfmTagCount = 0
let lastfmSearchCount = 0

/** Increment the iTunes outbound-request counter by 1. */
export function incItunes(): void {
  itunesCount++
}

/** Increment the Spotify outbound-request counter by 1. */
export function incSpotify(): void {
  spotifyCount++
}

/** Increment the Last.fm artist.getSimilar live-call counter by 1. */
export function incLastfmSimilar(): void {
  lastfmSimilarCount++
}

/** Increment the Last.fm artist.getInfo live-call counter by 1. */
export function incLastfmGetInfo(): void {
  lastfmGetInfoCount++
}

/** Increment the Last.fm tag.gettopartists live-call counter by 1. */
export function incLastfmTag(): void {
  lastfmTagCount++
}

/** Increment the Last.fm artist.search live-call counter by 1. */
export function incLastfmSearch(): void {
  lastfmSearchCount++
}

export interface CallSnapshot {
  itunes: number
  spotify: number
  lastfm: {
    similar: number
    getInfo: number
    tag: number
    search: number
    total: number
  }
}

/** Return current totals without resetting. */
export function snapshotCalls(): CallSnapshot {
  return {
    itunes: itunesCount,
    spotify: spotifyCount,
    lastfm: {
      similar: lastfmSimilarCount,
      getInfo: lastfmGetInfoCount,
      tag: lastfmTagCount,
      search: lastfmSearchCount,
      total: lastfmSimilarCount + lastfmGetInfoCount + lastfmTagCount + lastfmSearchCount,
    },
  }
}

/** Reset all counters to 0. Call immediately before a generation run. */
export function resetCalls(): void {
  itunesCount = 0
  spotifyCount = 0
  lastfmSimilarCount = 0
  lastfmGetInfoCount = 0
  lastfmTagCount = 0
  lastfmSearchCount = 0
}
