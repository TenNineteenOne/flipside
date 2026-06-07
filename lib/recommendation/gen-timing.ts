export interface GenTiming {
  userId: string
  /** Phase wall-clock durations in ms (e.g. gather, primary). Order preserved. */
  phases: Record<string, number>
  totalMs: number
  misses?: number
  retries?: number
  rateLimited?: boolean
  /** iTunes outbound API calls made during the blocking generate (before after()). */
  itunesCalls?: number
  /** Spotify outbound API calls made during the blocking generate (before after()). */
  spotifyCalls?: number
  /**
   * Per-endpoint LIVE Last.fm calls during the blocking generate (cache hits
   * excluded). The measurement gate for the Spotify-independence effort (#147).
   */
  lastfmCalls?: {
    similar: number
    getInfo: number
    tag: number
    search: number
    total: number
  }
}

/**
 * Format a single structured log line for one generation run. Numbers are
 * rounded to whole ms. Used to drive the measurement-led tuning in this plan
 * (blocking pool size + resolver concurrency/delay) against real numbers.
 */
export function formatGenTiming(t: GenTiming): string {
  const phaseBits = Object.entries(t.phases).map(([k, v]) => `${k}=${Math.round(v)}`)
  const parts = [
    "[gen-timing]",
    `user=${t.userId}`,
    ...phaseBits,
    `total=${Math.round(t.totalMs)}`,
    `misses=${t.misses ?? 0}`,
    `retries=${t.retries ?? 0}`,
    `rl=${t.rateLimited ?? false}`,
  ]
  if (t.itunesCalls !== undefined) parts.push(`itunesCalls=${t.itunesCalls}`)
  if (t.spotifyCalls !== undefined) parts.push(`spotifyCalls=${t.spotifyCalls}`)
  if (t.lastfmCalls !== undefined) {
    const l = t.lastfmCalls
    parts.push(
      `lastfmCalls=${l.total}`,
      `lastfm(similar=${l.similar},getInfo=${l.getInfo},tag=${l.tag},search=${l.search})`,
    )
  }
  return parts.join(" ")
}
