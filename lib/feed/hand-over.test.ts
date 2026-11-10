import { describe, it, expect } from "vitest"
import { shouldHandOver } from "./hand-over"

describe("shouldHandOver", () => {
  it("hands over when another artist's track is playing", () => {
    expect(shouldHandOver("b", true, "a")).toBe(true)
  })
  it("hands over when the playing track belongs to no feed artist", () => {
    expect(shouldHandOver("b", true, null)).toBe(true)
  })
  it("does nothing when this artist is already playing", () => {
    expect(shouldHandOver("a", true, "a")).toBe(false)
  })
  it("does nothing when nothing is playing or audio is paused", () => {
    expect(shouldHandOver("b", false, null)).toBe(false)
    expect(shouldHandOver("b", false, "a")).toBe(false)
  })
})
