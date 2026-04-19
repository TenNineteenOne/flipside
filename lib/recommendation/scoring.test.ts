import { describe, it, expect } from "vitest"
import { tierMultiplier } from "./engine"
import { UNDERGROUND_MAX_POPULARITY } from "./types"

describe("tierMultiplier (exponential decay)", () => {
  it("returns 1.0 at popularity 0", () => {
    expect(tierMultiplier(0)).toBe(1.0)
  })

  it("heavily penalizes high popularity", () => {
    expect(tierMultiplier(50)).toBeLessThan(0.10)
    expect(tierMultiplier(70)).toBeLessThan(0.05)
    expect(tierMultiplier(100)).toBeLessThan(0.01)
  })

  it("preserves most of the score for low popularity", () => {
    expect(tierMultiplier(5)).toBeGreaterThan(0.7)
    expect(tierMultiplier(10)).toBeGreaterThan(0.5)
  })

  it("is monotonically decreasing", () => {
    let prev = tierMultiplier(0)
    for (let p = 1; p <= 100; p++) {
      const curr = tierMultiplier(p)
      expect(curr).toBeLessThan(prev)
      prev = curr
    }
  })

  it("has no cliff between pop 30 and pop 31", () => {
    const at30 = tierMultiplier(30)
    const at31 = tierMultiplier(31)
    // Old step function had a 4x cliff (1.0 -> 0.25). Smooth curve should be < 10% difference.
    const ratio = at30 / at31
    expect(ratio).toBeLessThan(1.1)
    expect(ratio).toBeGreaterThan(1.0)
  })

  it("always returns a positive value", () => {
    for (let p = 0; p <= 100; p++) {
      expect(tierMultiplier(p)).toBeGreaterThan(0)
    }
  })
})

describe("UNDERGROUND_MAX_POPULARITY", () => {
  it("is pinned to 50 so the engine filter and UI cliff stay aligned", () => {
    // Changing this value requires updating the curve-preview cliff, excluded-zone
    // shading, and user-facing docs that promise "never above X popularity".
    expect(UNDERGROUND_MAX_POPULARITY).toBe(50)
  })
})
