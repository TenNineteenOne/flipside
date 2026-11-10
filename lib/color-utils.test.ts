import { describe, it, expect } from "vitest"
import { chipColors, readableTextOn } from "./color-utils"

describe("readableTextOn", () => {
  it("white on dark and saturated colours", () => {
    expect(readableTextOn("#000000")).toBe("#ffffff")
    expect(readableTextOn("#5b21b6")).toBe("#ffffff")
  })
  it("dark ink on light colours", () => {
    expect(readableTextOn("#ffffff")).toBe("#14121a")
    expect(readableTextOn("#f5d76e")).toBe("#14121a")
  })
  it("picks the higher-contrast ink for mid tones (violet #8b5cf6: 4.7:1 dark vs 3.9:1 white)", () => {
    expect(readableTextOn("#8b5cf6")).toBe("#14121a")
  })
  it("invalid input is treated as the default violet", () => {
    expect(readableTextOn("nope")).toBe(readableTextOn("#8b5cf6"))
  })
})

describe("chipColors", () => {
  const hues = (hex: string) => chipColors(hex).map((c) => Number(c.match(/ (\d+)\)$/)![1]))
  it("never uses yellow-green and gives three distinct colours", () => {
    for (const hex of ["#b03a2e", "#d9774a", "#2f7a4f", "#3b5bdb", "#c2307a", "#c9b458", "#2bb3a3", "#5c5c66", "#8b5cf6"]) {
      const h = hues(hex)
      expect(new Set(h).size).toBe(3)
      for (const x of h) expect(x < 90 || x > 150).toBe(true)
    }
  })
  it("gives a gold artist (Glass Beams) mint, sky and orchid", () => {
    expect(hues("#c48a2c")).toEqual([160, 230, 340])
  })
  it("gives a red artist no green-yellow", () => {
    expect(hues("#b03a2e")).toEqual([160, 230, 290])
  })
})
