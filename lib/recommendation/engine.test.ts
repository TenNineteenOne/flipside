import { describe, it, expect, vi } from "vitest"
import { buildRoundRobinNames, greedyPickTop, runDeepHop } from "./engine"
import type { ScoredArtist } from "./types"
import type { ArtistWithTracks } from "@/lib/music-provider/types"
import type { SimilarArtistRef } from "@/lib/music-provider"

function artist(id: string, name: string, popularity = 50, genre = "rock"): ArtistWithTracks {
  return { id, name, genres: [genre], imageUrl: null, popularity, topTracks: [] }
}

function scored(
  id: string,
  score: number,
  sourceArtists: string[] = [],
  genre = "rock",
  popularity = 50
): ScoredArtist {
  return {
    artist: artist(id, id, popularity, genre),
    score,
    why: { sourceArtists, genres: [genre], friendBoost: [] },
    source: "test",
  }
}

describe("buildRoundRobinNames", () => {
  it("returns empty when all seeds have empty similar lists", () => {
    const r = buildRoundRobinNames(
      [{ seed: "A", names: [] }, { seed: "B", names: [] }],
      new Set()
    )
    expect(r).toEqual([])
  })

  it("interleaves seeds in round-robin order", () => {
    const r = buildRoundRobinNames(
      [
        { seed: "A", names: ["a1", "a2", "a3"] },
        { seed: "B", names: ["b1", "b2", "b3"] },
      ],
      new Set()
    )
    expect(r).toEqual(["a1", "b1", "a2", "b2", "a3", "b3"])
  })

  it("dedups across seeds (first occurrence wins)", () => {
    const r = buildRoundRobinNames(
      [
        { seed: "A", names: ["x", "a2"] },
        { seed: "B", names: ["x", "b2"] },
      ],
      new Set()
    )
    expect(r).toEqual(["x", "a2", "b2"])
  })

  it("dedup is case-insensitive", () => {
    const r = buildRoundRobinNames(
      [
        { seed: "A", names: ["Khruangbin"] },
        { seed: "B", names: ["khruangbin"] },
      ],
      new Set()
    )
    expect(r).toEqual(["Khruangbin"])
  })

  it("filters names present in knownNames (user's own seeds)", () => {
    const r = buildRoundRobinNames(
      [{ seed: "A", names: ["Arctic Monkeys", "The Strokes"] }],
      new Set(["arctic monkeys"])
    )
    expect(r).toEqual(["The Strokes"])
  })

  it("no single seed can contribute more than ceil(cap/seeds) to top-N slots", () => {
    // 6 seeds, each returning 10 distinct similars. Cap to 60 slots.
    const lfm = Array.from({ length: 6 }, (_, s) => ({
      seed: `S${s}`,
      names: Array.from({ length: 10 }, (_, i) => `s${s}_n${i}`),
    }))
    const r = buildRoundRobinNames(lfm, new Set()).slice(0, 60)
    // Each seed should contribute exactly 10 of the 60 slots.
    for (let s = 0; s < 6; s++) {
      const fromSeed = r.filter((n) => n.startsWith(`s${s}_`)).length
      expect(fromSeed).toBe(10)
    }
  })

  it("handles uneven seed list lengths without padding dead slots", () => {
    const r = buildRoundRobinNames(
      [
        { seed: "A", names: ["a1"] },
        { seed: "B", names: ["b1", "b2", "b3"] },
      ],
      new Set()
    )
    expect(r).toEqual(["a1", "b1", "b2", "b3"])
  })

  it("tailFirst reverses per-seed iteration order", () => {
    const r = buildRoundRobinNames(
      [
        { seed: "A", names: ["a1", "a2", "a3"] },
        { seed: "B", names: ["b1", "b2", "b3"] },
      ],
      new Set(),
      { tailFirst: true }
    )
    expect(r).toEqual(["a3", "b3", "a2", "b2", "a1", "b1"])
  })

  it("tailFirst handles uneven seed lengths without skipping short-seed tails", () => {
    const r = buildRoundRobinNames(
      [
        { seed: "A", names: ["a1", "a2", "a3", "a4", "a5"] },
        { seed: "B", names: ["b1"] },
      ],
      new Set(),
      { tailFirst: true }
    )
    // Cycle 0: a5, b1. Cycle 1-4: a4, a3, a2, a1.
    expect(r).toEqual(["a5", "b1", "a4", "a3", "a2", "a1"])
  })

  it("tailFirst prioritizes low-similarity (tail) picks across seeds", () => {
    // Simulates 6 seeds with 50 similars each, ordered head (mainstream) → tail (niche).
    // Under tail-first round-robin, the first 60 slots should all come from the tail.
    const lfm = Array.from({ length: 6 }, (_, s) => ({
      seed: `S${s}`,
      names: Array.from({ length: 50 }, (_, i) => `s${s}_idx${i}`),
    }))
    const r = buildRoundRobinNames(lfm, new Set(), { tailFirst: true }).slice(0, 60)
    // Every item in the top 60 should have idx >= 40 (bottom 20%).
    for (const name of r) {
      const idx = parseInt(name.split("_idx")[1], 10)
      expect(idx).toBeGreaterThanOrEqual(40)
    }
  })

  it("one mainstream-biased seed cannot flood the pool when other seeds have variety", () => {
    // Simulates: one seed returns 15 mainstream artists; others have only a
    // few similars. Under seed-order dedup, the mainstream seed's 15 artists
    // would fill most of the first 20 slots. Round-robin caps its contribution.
    const lfm = [
      { seed: "Other1", names: ["o1a", "o1b", "o1c", "o1d", "o1e"] },
      { seed: "Other2", names: ["o2a", "o2b", "o2c"] },
      {
        seed: "Mainstream",
        names: Array.from({ length: 15 }, (_, i) => `m${i}`),
      },
    ]
    const r = buildRoundRobinNames(lfm, new Set()).slice(0, 20)
    const mainstream = r.filter((n) => n.startsWith("m")).length
    // In round-robin, Mainstream gets 1 slot per cycle. After ~5 cycles the
    // other seeds are exhausted, so Mainstream fills remaining slots — but
    // NOT before every other name has been included.
    expect(mainstream).toBeLessThanOrEqual(15)
    // All Other1 + Other2 names should appear before we run out of round-robin slots.
    expect(r).toContain("o1a")
    expect(r).toContain("o2a")
    expect(r).toContain("o1e")
  })
})

describe("greedyPickTop", () => {
  it("picks all items when pool size is <= maxSize", () => {
    const pool = [scored("a", 0.9), scored("b", 0.5), scored("c", 0.3)]
    const top = greedyPickTop(pool, 20)
    expect(top.length).toBe(3)
  })

  it("without diversity pressure, picks in descending score order", () => {
    const pool = [
      scored("a", 0.1, ["S1"], "rock"),
      scored("b", 0.3, ["S2"], "jazz"),
      scored("c", 0.5, ["S3"], "pop"),
      scored("d", 0.7, ["S4"], "folk"),
    ]
    const top = greedyPickTop(pool, 4)
    expect(top.map((t) => t.artist.id)).toEqual(["d", "c", "b", "a"])
  })

  it("does not mutate the input pool", () => {
    const pool = [scored("a", 0.9), scored("b", 0.5)]
    const snapshot = [...pool]
    greedyPickTop(pool, 1)
    expect(pool).toEqual(snapshot)
  })

  it("penalizes candidates that share source seeds with already-picked ones", () => {
    // 15 candidates share source "A" at score 0.30; 5 candidates share source
    // "B" at score 0.28. Without a per-seed penalty, "A" sweeps all 20 slots
    // (the 5 "B" candidates are blocked by lower score). With the penalty,
    // after 3 "A" picks the 4th "A" gets -0.12, so "B" starts winning.
    const poolA = Array.from({ length: 15 }, (_, i) => scored(`a${i}`, 0.30, ["A"], `g_a${i}`))
    const poolB = Array.from({ length: 5 }, (_, i) => scored(`b${i}`, 0.28, ["B"], `g_b${i}`))
    const top = greedyPickTop([...poolA, ...poolB], 20)
    const fromB = top.filter((t) => t.why.sourceArtists.includes("B")).length
    expect(fromB).toBeGreaterThanOrEqual(3)
  })

  it("still fills all slots when every candidate shares one source seed", () => {
    // Degenerate case: only one seed's similars exist. Penalty must not
    // prevent the feed from filling.
    const pool = Array.from({ length: 30 }, (_, i) => scored(`a${i}`, 0.30 - i * 0.001, ["OnlySeed"], `g${i}`))
    const top = greedyPickTop(pool, 20)
    expect(top.length).toBe(20)
  })

  it("genre penalty still applies when source seeds overlap", () => {
    // All from one seed, all same genre except one. Genre penalty should
    // push the odd-genre item up relative to its raw score rank.
    const pool = [
      scored("a1", 0.50, ["S"], "rock"),
      scored("a2", 0.48, ["S"], "rock"),
      scored("a3", 0.46, ["S"], "rock"),
      scored("a4", 0.44, ["S"], "rock"),
      scored("odd", 0.40, ["S"], "jazz"),
    ]
    const top = greedyPickTop(pool, 5)
    // Without diversity, odd would be last (rank 5). With genre + seed
    // penalties stacking on the rock/S combo, odd should move up.
    const oddIdx = top.findIndex((t) => t.artist.id === "odd")
    expect(oddIdx).toBeLessThan(4)
  })

  it("respects maxSize even when more candidates are available", () => {
    const pool = Array.from({ length: 50 }, (_, i) => scored(`a${i}`, 1 - i * 0.01))
    const top = greedyPickTop(pool, 20)
    expect(top.length).toBe(20)
  })
})

function ref(name: string, match: number): SimilarArtistRef {
  return { name, match }
}

describe("runDeepHop", () => {
  it("fetches 2nd-hop for each seed's N lowest-match first-hop items", async () => {
    const firstHop = [
      {
        seed: "Drake",
        items: [ref("Kendrick", 0.9), ref("Tyler", 0.8), ref("Obscure1", 0.2), ref("Obscure2", 0.1), ref("Obscure3", 0.05)],
      },
    ]
    const calls: string[] = []
    const fetchSimilar = vi.fn(async (name: string): Promise<SimilarArtistRef[]> => {
      calls.push(name)
      return [ref(`${name}-related`, 0.5)]
    })

    const result = await runDeepHop(firstHop, fetchSimilar, 3)
    // Only the 3 lowest-match items are hopped from.
    expect(calls.sort()).toEqual(["Obscure1", "Obscure2", "Obscure3"])
    // The parent seed's item list was extended with the hop results.
    const drake = result.find((r) => r.seed === "Drake")!
    expect(drake.items.map((i) => i.name)).toEqual(
      expect.arrayContaining(["Kendrick", "Obscure1", "Obscure1-related", "Obscure2-related", "Obscure3-related"])
    )
  })

  it("handles seeds with fewer items than hopsPerSeed", async () => {
    const firstHop = [{ seed: "Niche", items: [ref("A", 0.5)] }]
    const fetchSimilar = vi.fn(async (name: string): Promise<SimilarArtistRef[]> => [ref(`${name}-hop`, 0.3)])
    const result = await runDeepHop(firstHop, fetchSimilar, 3)
    expect(fetchSimilar).toHaveBeenCalledTimes(1)
    expect(result[0].items.map((i) => i.name)).toEqual(["A", "A-hop"])
  })

  it("dedupes hop items against existing first-hop items (case-insensitive)", async () => {
    const firstHop = [{ seed: "Seed", items: [ref("Already", 0.9), ref("Niche", 0.1)] }]
    const fetchSimilar = vi.fn(async (): Promise<SimilarArtistRef[]> => [
      ref("already", 0.4),  // case-insensitive dup of Already
      ref("Fresh", 0.3),
    ])
    const result = await runDeepHop(firstHop, fetchSimilar, 3)
    const names = result[0].items.map((i) => i.name)
    expect(names).toEqual(["Already", "Niche", "Fresh"])
  })

  it("preserves per-seed isolation — hops from seed A don't pollute seed B", async () => {
    const firstHop = [
      { seed: "A", items: [ref("A-niche", 0.1)] },
      { seed: "B", items: [ref("B-niche", 0.1)] },
    ]
    const fetchSimilar = vi.fn(async (name: string): Promise<SimilarArtistRef[]> => [ref(`${name}-hop`, 0.3)])
    const result = await runDeepHop(firstHop, fetchSimilar, 3)
    const a = result.find((r) => r.seed === "A")!
    const b = result.find((r) => r.seed === "B")!
    expect(a.items.map((i) => i.name)).toEqual(["A-niche", "A-niche-hop"])
    expect(b.items.map((i) => i.name)).toEqual(["B-niche", "B-niche-hop"])
  })

  it("handles empty first-hop items without crashing", async () => {
    const fetchSimilar = vi.fn(async (): Promise<SimilarArtistRef[]> => [])
    const result = await runDeepHop([{ seed: "Seed", items: [] }], fetchSimilar, 3)
    expect(fetchSimilar).not.toHaveBeenCalled()
    expect(result[0].items).toEqual([])
  })
})
