/**
 * Cache-window helpers for the Feed engine and its far pool (far-picks.ts),
 * kept in their own module so far-picks can import them without a cycle
 * through engine.ts.
 */

/**
 * Deterministic cache-window hash. Keeps rail picks stable within the TTL so
 * a re-fetch during the same cache window doesn't shuffle results under the
 * user's feet (and can't be exploited to game uniqueness).
 */
export function cacheWindowSeed(userId: string, seedKey: string): number {
  const weekStart = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000))
  let h = 2166136261 >>> 0
  const s = `${userId}:${seedKey}:${weekStart}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/**
 * Stable shuffle using the cache-window seed so the same user + same rail
 * produces the same order within a 7-day window.
 */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr]
  let s = seed >>> 0
  for (let i = out.length - 1; i > 0; i--) {
    // mulberry32, index from the high bits: an LCG's low bits (`s % n`) cycle with tiny periods.
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const j = Math.floor((((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Roll a deterministic sample of up to `size` likes from a user's full
 * thumbs-up set. Seed is the cache window so the sample is stable across
 * in-window cache hits but rotates weekly.
 */
export const LIKE_SAMPLE_SIZE = 10

export function sampleLikes(allLikes: string[], userId: string): string[] {
  if (allLikes.length <= LIKE_SAMPLE_SIZE) return allLikes
  return seededShuffle(allLikes, cacheWindowSeed(userId, 'like-sample')).slice(
    0,
    LIKE_SAMPLE_SIZE,
  )
}
