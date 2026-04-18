import { describe, it, expect } from "vitest"
import { stringToVibrantHex, hexToRgba } from "../color-utils"

describe("stringToVibrantHex", () => {
  it("returns a valid 7-char hex string", () => {
    const result = stringToVibrantHex("Radiohead")
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
  })

  it("returns deterministic output for the same input", () => {
    const a = stringToVibrantHex("Aphex Twin")
    const b = stringToVibrantHex("Aphex Twin")
    expect(a).toBe(b)
  })

  it("returns different colors for different inputs", () => {
    const a = stringToVibrantHex("Radiohead")
    const b = stringToVibrantHex("Boards of Canada")
    expect(a).not.toBe(b)
  })

  it("handles an empty string without throwing", () => {
    const result = stringToVibrantHex("")
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
  })

  it("handles special characters", () => {
    const result = stringToVibrantHex("$uicideboy$ & Pouya")
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
  })

  it("handles unicode / emoji characters", () => {
    const result = stringToVibrantHex("100 gecs \u2764\uFE0F")
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe("hexToRgba", () => {
  it("converts a 6-char hex to rgba", () => {
    const result = hexToRgba("#ff0000", 1)
    expect(result).toBe("rgba(255, 0, 0, 1)")
  })

  it("converts a 3-char shorthand hex to rgba", () => {
    const result = hexToRgba("#f00", 0.5)
    expect(result).toBe("rgba(255, 0, 0, 0.5)")
  })

  it("handles hex without leading #", () => {
    const result = hexToRgba("00ff00", 0.8)
    expect(result).toBe("rgba(0, 255, 0, 0.8)")
  })

  it("handles alpha = 0", () => {
    const result = hexToRgba("#000000", 0)
    expect(result).toBe("rgba(0, 0, 0, 0)")
  })

  it("handles white", () => {
    const result = hexToRgba("#ffffff", 1)
    expect(result).toBe("rgba(255, 255, 255, 1)")
  })

  it("handles the default fallback purple", () => {
    const result = hexToRgba("#8b5cf6", 0.45)
    expect(result).toBe("rgba(139, 92, 246, 0.45)")
  })

  it("produces valid rgba for empty hex (edge case)", () => {
    // Empty string edge: parseInt("", 16) => NaN => 0
    const result = hexToRgba("", 1)
    expect(result).toBe("rgba(0, 0, 0, 1)")
  })
})
