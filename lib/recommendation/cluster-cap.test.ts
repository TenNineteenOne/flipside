import { describe, it, expect } from "vitest"
import { applyClusterCap, CLUSTER_CAP_PCT } from "./cluster-cap"

type A = { id: string; genres?: string[] }
const primaryGenreOf = (t: A): string => t.genres?.[0] || "unknown"

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

  it("handles missing genres via an unknown fallback", () => {
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
})
