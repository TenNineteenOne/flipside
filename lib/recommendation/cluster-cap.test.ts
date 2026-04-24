import { describe, it, expect } from "vitest"
import {
  applyClusterCap,
  applyCrossRailClusterCap,
  primaryGenreOf,
  CLUSTER_CAP_PCT,
} from "./cluster-cap"

type A = { id: string; genres?: string[] }

const a = (id: string, g: string): A => ({ id, genres: [g] })

describe("applyClusterCap", () => {
  it("no-ops when nothing is over the cap", () => {
    const picks = [a("1", "rock"), a("2", "pop"), a("3", "jazz"), a("4", "rock")]
    const leftover = [a("5", "pop")]
    const before = picks.map((p) => p.id)
    applyClusterCap(picks, leftover, primaryGenreOf, 0.5)
    expect(picks.map((p) => p.id)).toEqual(before)
  })

  it("swaps over-cap offender with under-cap leftover", () => {
    // 4 rock in 4 picks → 100% > 25% cap
    const picks = [a("1", "rock"), a("2", "rock"), a("3", "rock"), a("4", "rock")]
    const leftover = [a("5", "pop"), a("6", "jazz"), a("7", "electronic"), a("8", "folk")]
    applyClusterCap(picks, leftover, primaryGenreOf, 0.25)
    // ceil(4 * 0.25) = 1, so at most 1 rock allowed
    const rockCount = picks.filter((p) => p.genres?.[0] === "rock").length
    expect(rockCount).toBeLessThanOrEqual(1)
  })

  it("prefers the lowest-ranked offender when swapping", () => {
    const picks = [a("1", "rock"), a("2", "pop"), a("3", "rock")]
    const leftover = [a("4", "jazz")]
    // cap = ceil(3 * 0.25) = 1; rock count = 2 (over). Lowest-ranked rock is id 3.
    applyClusterCap(picks, leftover, primaryGenreOf, 0.25)
    expect(picks.find((p) => p.id === "1")).toBeTruthy() // highest-ranked rock kept
    expect(picks.find((p) => p.id === "3")).toBeFalsy() // lowest-ranked rock demoted
    expect(picks.find((p) => p.id === "4")).toBeTruthy() // leftover promoted
  })

  it("picks the highest-ranked under-cap leftover first", () => {
    const picks = [a("1", "rock"), a("2", "rock"), a("3", "rock")]
    const leftover = [a("4", "pop"), a("5", "jazz")]
    applyClusterCap(picks, leftover, primaryGenreOf, 0.25)
    // First under-cap leftover (pop, id 4) should be promoted.
    expect(picks.find((p) => p.id === "4")).toBeTruthy()
  })

  it("leaves offenders in place when no under-cap leftover exists", () => {
    const picks = [a("1", "rock"), a("2", "rock"), a("3", "rock")]
    const leftover = [a("4", "rock"), a("5", "rock")]
    applyClusterCap(picks, leftover, primaryGenreOf, 0.25)
    expect(picks.map((p) => p.genres?.[0])).toEqual(["rock", "rock", "rock"])
  })

  it("moves the demoted offender into leftover", () => {
    const picks = [a("1", "rock"), a("2", "rock")]
    const leftover = [a("3", "pop")]
    applyClusterCap(picks, leftover, primaryGenreOf, 0.25)
    expect(leftover.map((l) => l.id).sort()).toContain("2")
  })

  it("handles missing genres via primaryGenreOf fallback", () => {
    const picks = [
      { id: "1", genres: [] },
      { id: "2", genres: [] },
    ]
    const leftover = [a("3", "jazz")]
    applyClusterCap(picks, leftover, primaryGenreOf, 0.25)
    // Both picks have unknown genre, that's over cap — swap in jazz.
    expect(picks.find((p) => p.id === "3")).toBeTruthy()
  })

  it("is deterministic across repeated runs", () => {
    const build = () => ({
      picks: [a("1", "rock"), a("2", "rock"), a("3", "rock"), a("4", "pop")],
      leftover: [a("5", "jazz"), a("6", "electronic"), a("7", "pop")],
    })
    const one = build()
    applyClusterCap(one.picks, one.leftover, primaryGenreOf, 0.25)
    const two = build()
    applyClusterCap(two.picks, two.leftover, primaryGenreOf, 0.25)
    expect(one.picks.map((p) => p.id)).toEqual(two.picks.map((p) => p.id))
  })
})

describe("applyCrossRailClusterCap", () => {
  it("swaps within-rail only", () => {
    // Rail A: 4 rock. Rail B: 4 jazz. Cap = ceil(8 * 0.25) = 2.
    const railA = {
      picks: [a("a1", "rock"), a("a2", "rock"), a("a3", "rock"), a("a4", "rock")],
      leftover: [a("a5", "pop")],
    }
    const railB = {
      picks: [a("b1", "jazz"), a("b2", "jazz"), a("b3", "jazz"), a("b4", "jazz")],
      leftover: [a("b5", "electronic")],
    }
    applyCrossRailClusterCap([railA, railB], primaryGenreOf, 0.25)
    // Rail A should not contain b5, and rail B should not contain a5.
    expect(railA.picks.find((p) => p.id === "b5")).toBeFalsy()
    expect(railB.picks.find((p) => p.id === "a5")).toBeFalsy()
  })

  it("targets the rail with the highest concentration of the over-genre", () => {
    // Rail A has 4 rock, Rail B has 1 rock. Cap = ceil(10 * 0.25) = 3.
    // Rock count = 5, over cap by 2. Rail A should lose rock, not B.
    const railA = {
      picks: [a("a1", "rock"), a("a2", "rock"), a("a3", "rock"), a("a4", "rock"), a("a5", "pop")],
      leftover: [a("a6", "jazz"), a("a7", "jazz")],
    }
    const railB = {
      picks: [a("b1", "pop"), a("b2", "pop"), a("b3", "pop"), a("b4", "pop"), a("b5", "rock")],
      leftover: [a("b6", "jazz")],
    }
    applyCrossRailClusterCap([railA, railB], primaryGenreOf, 0.25)
    const rockInA = railA.picks.filter((p) => p.genres?.[0] === "rock").length
    const rockInB = railB.picks.filter((p) => p.genres?.[0] === "rock").length
    expect(rockInA).toBeLessThanOrEqual(2)
    expect(rockInB).toBe(1) // untouched
  })

  it("respects the cap across all rails combined", () => {
    const railA = {
      picks: [a("a1", "rock"), a("a2", "rock"), a("a3", "rock")],
      leftover: [a("a4", "pop"), a("a5", "jazz")],
    }
    const railB = {
      picks: [a("b1", "rock"), a("b2", "rock"), a("b3", "rock")],
      leftover: [a("b4", "pop"), a("b5", "electronic")],
    }
    applyCrossRailClusterCap([railA, railB], primaryGenreOf, 0.25)
    const total = [...railA.picks, ...railB.picks]
    const rockTotal = total.filter((p) => p.genres?.[0] === "rock").length
    expect(rockTotal).toBeLessThanOrEqual(Math.ceil(total.length * 0.25))
  })

  it("no-ops when already under cap", () => {
    const railA = {
      picks: [a("a1", "rock"), a("a2", "pop"), a("a3", "jazz"), a("a4", "electronic")],
      leftover: [a("a5", "folk")],
    }
    const railB = {
      picks: [a("b1", "rock"), a("b2", "pop"), a("b3", "jazz"), a("b4", "electronic")],
      leftover: [a("b5", "folk")],
    }
    const before = [...railA.picks.map((p) => p.id), ...railB.picks.map((p) => p.id)]
    applyCrossRailClusterCap([railA, railB], primaryGenreOf)
    const after = [...railA.picks.map((p) => p.id), ...railB.picks.map((p) => p.id)]
    expect(after).toEqual(before)
  })

  it("gives up cleanly when no valid swap exists in any rail", () => {
    // Every leftover is also the over-cap genre → no valid swap.
    const railA = {
      picks: [a("a1", "rock"), a("a2", "rock"), a("a3", "rock")],
      leftover: [a("a4", "rock")],
    }
    const railB = {
      picks: [a("b1", "rock"), a("b2", "rock"), a("b3", "rock")],
      leftover: [a("b4", "rock")],
    }
    applyCrossRailClusterCap([railA, railB], primaryGenreOf, 0.25)
    // Same composition — just returns without infinite loop.
    expect(railA.picks.every((p) => p.genres?.[0] === "rock")).toBe(true)
    expect(railB.picks.every((p) => p.genres?.[0] === "rock")).toBe(true)
  })

  it("handles empty rails", () => {
    const empty = { picks: [] as A[], leftover: [] as A[] }
    const normal = {
      picks: [a("1", "rock"), a("2", "pop")],
      leftover: [a("3", "jazz")],
    }
    applyCrossRailClusterCap([empty, normal], primaryGenreOf)
    expect(normal.picks).toHaveLength(2)
  })
})

describe("CLUSTER_CAP_PCT", () => {
  it("is 25%", () => {
    expect(CLUSTER_CAP_PCT).toBe(0.25)
  })
})

describe("CapStats telemetry", () => {
  it("applyClusterCap counts swaps and reports top share", () => {
    const picks = [a("1", "rock"), a("2", "rock"), a("3", "rock"), a("4", "rock")]
    const leftover = [a("5", "pop"), a("6", "jazz"), a("7", "electronic")]
    const stats = applyClusterCap(picks, leftover, primaryGenreOf, 0.25)
    expect(stats.swaps).toBeGreaterThan(0)
    expect(stats.topShare).toBeLessThanOrEqual(0.5)
    expect(stats.topGenre).toBeTruthy()
  })

  it("applyClusterCap returns zero swaps when already compliant", () => {
    const picks = [a("1", "rock"), a("2", "pop"), a("3", "jazz"), a("4", "electronic")]
    const leftover = [a("5", "folk")]
    const stats = applyClusterCap(picks, leftover, primaryGenreOf, 0.25)
    expect(stats.swaps).toBe(0)
    expect(stats.topShare).toBe(0.25)
  })

  it("applyCrossRailClusterCap reports total-surface topShare", () => {
    const railA = {
      picks: [a("a1", "rock"), a("a2", "rock")],
      leftover: [a("a3", "pop"), a("a4", "jazz"), a("a5", "electronic")],
    }
    const railB = {
      picks: [a("b1", "rock"), a("b2", "rock")],
      leftover: [a("b3", "folk"), a("b4", "soul"), a("b5", "funk")],
    }
    const stats = applyCrossRailClusterCap([railA, railB], primaryGenreOf, 0.25)
    expect(stats.swaps).toBeGreaterThan(0)
    // 4 picks total; cap = ceil(4 * 0.25) = 1, so max 1 rock → topShare ≤ 0.25.
    expect(stats.topShare).toBeLessThanOrEqual(0.25)
  })
})
