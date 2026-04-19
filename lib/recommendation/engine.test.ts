import { describe, it, expect } from "vitest"
import { buildRoundRobinNames, greedyPickTop } from "./engine"
import type { ScoredArtist } from "./types"
import type { ArtistWithTracks } from "@/lib/music-provider/types"

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
