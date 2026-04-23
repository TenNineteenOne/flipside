/**
 * Six-degrees similarity chain walker.
 *
 * Given a source artist name + target artist name, BFS Last.fm `getSimilar`
 * up to `maxHops` deep to find a connecting chain. Caps total `getSimilar`
 * calls per walk at `maxCalls` so a single walk can't exceed its budget.
 *
 * Used by the Explore "From your wildcards" rail to render provenance under
 * cards. Also reusable by Adjacent / Outside rails in the future.
 *
 * Note: the current Wildcards implementation already populates a cheap
 * 1-hop chain inline (surfaced artists are always direct similars of the
 * seed). This walker is for the non-trivial case where a later rail
 * surfaces an artist that's not a direct similar and we want to show the
 * connecting path.
 */

import { musicProvider } from '@/lib/music-provider/provider'
import type { SimilarArtistRef } from '@/lib/music-provider'

export interface Chain {
  name: string
  match: number
}

export interface WalkOptions {
  maxHops?: number
  maxCalls?: number
  /** Sibling branching factor per layer (how many top similars to expand). */
  branching?: number
  /** Optional injected fetcher for testing. */
  fetchSimilar?: (name: string) => Promise<SimilarArtistRef[]>
}

const DEFAULT_MAX_HOPS = 6
const DEFAULT_MAX_CALLS = 12
const DEFAULT_BRANCHING = 5

/**
 * Find a chain from source → target via Last.fm similarity. Returns null
 * when no path is found within budget. The returned chain always starts
 * at `source` (match 1.0) and ends at `target`.
 */
export async function findSimilarityChain(
  source: string,
  target: string,
  opts: WalkOptions = {},
): Promise<Chain[] | null> {
  const {
    maxHops = DEFAULT_MAX_HOPS,
    maxCalls = DEFAULT_MAX_CALLS,
    branching = DEFAULT_BRANCHING,
    fetchSimilar = (n: string) => musicProvider.getSimilarArtistNames(n),
  } = opts

  if (!source || !target) return null
  if (source.toLowerCase() === target.toLowerCase()) {
    return [{ name: source, match: 1 }]
  }

  // BFS queue entries: { path: [{name,match}], name: string }
  type Entry = { path: Chain[]; name: string }
  const visited = new Set<string>([source.toLowerCase()])
  const queue: Entry[] = [{ path: [{ name: source, match: 1 }], name: source }]
  let calls = 0
  const targetLc = target.toLowerCase()

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.path.length - 1 >= maxHops) continue
    if (calls >= maxCalls) break

    let similars: SimilarArtistRef[]
    try {
      similars = await fetchSimilar(current.name)
      calls++
    } catch {
      continue
    }
    if (!Array.isArray(similars) || similars.length === 0) continue

    // Highest-match first (greedy-ish BFS).
    const sorted = [...similars].sort((a, b) => b.match - a.match)

    // If target is a direct similar, we're done.
    const direct = sorted.find((s) => s.name.toLowerCase() === targetLc)
    if (direct) {
      return [...current.path, { name: direct.name, match: direct.match }]
    }

    // Otherwise enqueue top `branching` unvisited similars for the next layer.
    let branched = 0
    for (const s of sorted) {
      if (branched >= branching) break
      const lc = s.name.toLowerCase()
      if (visited.has(lc)) continue
      visited.add(lc)
      queue.push({
        path: [...current.path, { name: s.name, match: s.match }],
        name: s.name,
      })
      branched++
    }
  }

  return null
}
