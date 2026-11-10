import { describe, it, expect } from "vitest"
import { FAME_LEVELS, fameToEngine, isFameLevel } from "./fame"

describe("fameToEngine", () => {
  it.each([
    [0, 0.9, true],
    [1, 0.92, false],
    [2, 0.95, false],
    [3, 0.97, false],
    [4, 0.99, false],
  ])("level %i → curve %d, underground %s", (level, curve, underground) => {
    expect(fameToEngine(level)).toEqual({ popularityCurve: curve, undergroundMode: underground })
  })

  it.each([null, undefined, -1, 5, 2.5, "2"])("invalid %j → default (Balanced)", (v) => {
    expect(fameToEngine(v)).toEqual({ popularityCurve: 0.95, undergroundMode: false })
  })

  it("has five labels", () => {
    expect(FAME_LEVELS).toEqual(["Underground only", "Mostly niche", "Balanced", "Mostly popular", "Anything goes"])
    expect(isFameLevel(4)).toBe(true)
    expect(isFameLevel(5)).toBe(false)
  })
})
