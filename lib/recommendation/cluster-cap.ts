/**
 * Pool cluster cap for the diversity overhaul (M2).
 *
 * Cluster = artist.genres[0] (primary genre). Cap is a fraction of the Feed's
 * top pool. When a genre exceeds the cap, we swap the lowest-ranked
 * offender(s) with the highest-ranked leftover whose genre is still under
 * the cap.
 *
 * Deterministic and idempotent given the same inputs — runs before cache
 * writes so cache-hit paths serve the capped result directly.
 */

export const CLUSTER_CAP_PCT = 0.25

/**
 * Cap a single ranked list in place. `picks` is the final visible list;
 * `leftover` is the ranked tail that didn't make the target. When a genre's
 * share of `picks` exceeds `ceil(picks.length * capPct)`, swap the lowest-
 * ranked offender with the highest-ranked under-cap leftover. Stops when no
 * over-cap genre remains or no valid swap is available.
 */
export interface CapStats {
  /** Number of swaps performed. */
  swaps: number
  /** Top-genre share after swapping (0..1). */
  topShare: number
  /** Primary genre with the highest post-cap count. */
  topGenre: string | null
}

export function applyClusterCap<T>(
  picks: T[],
  leftover: T[],
  getGenre: (t: T) => string,
  capPct: number = CLUSTER_CAP_PCT,
): CapStats {
  if (picks.length === 0) return { swaps: 0, topShare: 0, topGenre: null }
  const limit = Math.ceil(picks.length * capPct)
  const counts = new Map<string, number>()
  for (const p of picks) counts.set(getGenre(p), (counts.get(getGenre(p)) ?? 0) + 1)

  let swaps = 0
  let iters = 0
  const maxIters = picks.length * 4
  while (iters++ < maxIters) {
    let offenderIdx = -1
    for (let i = picks.length - 1; i >= 0; i--) {
      if ((counts.get(getGenre(picks[i])) ?? 0) > limit) {
        offenderIdx = i
        break
      }
    }
    if (offenderIdx < 0) break

    let leftIdx = -1
    for (let i = 0; i < leftover.length; i++) {
      const ng = getGenre(leftover[i])
      if ((counts.get(ng) ?? 0) < limit) {
        leftIdx = i
        break
      }
    }
    if (leftIdx < 0) break

    const out = picks[offenderIdx]
    const inn = leftover[leftIdx]
    picks[offenderIdx] = inn
    leftover.splice(leftIdx, 1, out)
    counts.set(getGenre(out), (counts.get(getGenre(out)) ?? 0) - 1)
    counts.set(getGenre(inn), (counts.get(getGenre(inn)) ?? 0) + 1)
    swaps++
  }

  let topGenre: string | null = null
  let topCount = 0
  for (const [g, c] of counts) {
    if (c > topCount) { topCount = c; topGenre = g }
  }
  return { swaps, topShare: topCount / picks.length, topGenre }
}
