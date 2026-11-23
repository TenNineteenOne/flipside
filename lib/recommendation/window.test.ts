import { describe, it, expect } from "vitest"
import { cacheWindowSeed, seededShuffle, sampleLikes, LIKE_SAMPLE_SIZE } from "./window"

describe("cacheWindowSeed", () => {
  it("is stable for same user + key within a cache window", () => {
    const a = cacheWindowSeed("user-1", "like-sample")
    const b = cacheWindowSeed("user-1", "like-sample")
    expect(a).toBe(b)
  })

  it("differs across keys", () => {
    const a = cacheWindowSeed("user-1", "like-sample")
    const b = cacheWindowSeed("user-1", "afterhours")
    expect(a).not.toBe(b)
  })

  it("differs across users", () => {
    const a = cacheWindowSeed("user-1", "like-sample")
    const b = cacheWindowSeed("user-2", "like-sample")
    expect(a).not.toBe(b)
  })
})

describe("seededShuffle", () => {
  it("is deterministic for the same seed", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `a${i}`)
    const first = seededShuffle(ids, 42)
    const second = seededShuffle(ids, 42)
    expect(first).toEqual(second)
  })

  it("differs for different seeds (probabilistically almost always)", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `a${i}`)
    const first = seededShuffle(ids, 42)
    const second = seededShuffle(ids, 99)
    expect(first).not.toEqual(second)
  })

  it("reaches all 24 orders of 4 items", () => {
    const seen = new Set<string>()
    for (let k = 0; k < 2000; k++) seen.add(seededShuffle(["a", "b", "c", "d"], cacheWindowSeed(`user-${k}`, "x")).join(""))
    expect(seen.size).toBe(24)
  })

  it("includes each of 100 items in a 10-sample about equally often", () => {
    const ids = Array.from({ length: 100 }, (_, i) => i)
    const counts = new Array<number>(100).fill(0)
    const RUNS = 20000
    for (let k = 0; k < RUNS; k++) {
      for (const id of seededShuffle(ids, cacheWindowSeed(`user-${k}`, "like-sample")).slice(0, 10)) counts[id]++
    }
    // Expected 10% each (sd ~0.2 points over 20k runs); the old generator gave 1.9%..18.5%.
    expect(Math.min(...counts) / RUNS).toBeGreaterThan(0.085)
    expect(Math.max(...counts) / RUNS).toBeLessThan(0.115)
  })

  it("does not mutate input", () => {
    const ids = ["a", "b", "c"]
    const copy = [...ids]
    seededShuffle(ids, 1)
    expect(ids).toEqual(copy)
  })
})

describe("sampleLikes", () => {
  it("returns all likes when fewer than the sample size", () => {
    const likes = ["a", "b", "c"]
    expect(sampleLikes(likes, "user-1")).toEqual(likes)
  })

  it("returns exactly LIKE_SAMPLE_SIZE when user has more", () => {
    const likes = Array.from({ length: 30 }, (_, i) => `a${i}`)
    const sample = sampleLikes(likes, "user-1")
    expect(sample).toHaveLength(LIKE_SAMPLE_SIZE)
  })

  it("only picks values from the input set", () => {
    const likes = Array.from({ length: 30 }, (_, i) => `a${i}`)
    const sample = sampleLikes(likes, "user-1")
    for (const s of sample) expect(likes).toContain(s)
  })

  it("is stable within a cache window for the same user", () => {
    const likes = Array.from({ length: 30 }, (_, i) => `a${i}`)
    const a = sampleLikes(likes, "user-1")
    const b = sampleLikes(likes, "user-1")
    expect(a).toEqual(b)
  })

  it("differs across users (probabilistically almost always)", () => {
    const likes = Array.from({ length: 30 }, (_, i) => `a${i}`)
    const a = sampleLikes(likes, "user-1")
    const b = sampleLikes(likes, "user-2")
    expect(a).not.toEqual(b)
  })
})
