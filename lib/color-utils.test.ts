import { describe, it, expect } from "vitest"
import { readableTextOn } from "./color-utils"

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
