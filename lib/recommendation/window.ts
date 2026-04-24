/**
 * Cache-window helpers shared between Feed and Explore engines.
 *
 * Kept in their own module so either engine can import without creating a
 * circular dependency (explore-engine.ts imports from engine.ts for
 * `getTagArtistNames`).
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
  let s = seed || 1
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Roll a deterministic sample of up to `size` likes from a user's full
 * thumbs-up set. Seed is the cache window so the sample is stable across
 * in-window cache hits but rotates weekly. Same sample in Feed and Explore
 * so the two surfaces feel coherent.
 */
export const LIKE_SAMPLE_SIZE = 10

export function sampleLikes(allLikes: string[], userId: string): string[] {
  if (allLikes.length <= LIKE_SAMPLE_SIZE) return allLikes
  return seededShuffle(allLikes, cacheWindowSeed(userId, 'like-sample')).slice(
    0,
    LIKE_SAMPLE_SIZE,
  )
}
