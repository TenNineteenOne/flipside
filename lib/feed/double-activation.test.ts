import { describe, it, expect } from "vitest"
import { isDoubleActivation } from "./double-activation"

describe("isDoubleActivation", () => {
  const last = { artistId: "a", at: 1000 }
  it("ignores an advancing decision on another artist within 350ms", () => {
    expect(isDoubleActivation(last, "b", true, 1349)).toBe(true)
  })
  it("allows it from 350ms on", () => {
    expect(isDoubleActivation(last, "b", true, 1350)).toBe(false)
  })
  it("allows a second decision on the same artist (un-like)", () => {
    expect(isDoubleActivation(last, "a", true, 1010)).toBe(false)
  })
  it("never blocks a non-advancing decision or the first one", () => {
    expect(isDoubleActivation(last, "b", false, 1010)).toBe(false)
    expect(isDoubleActivation(null, "b", true, 1010)).toBe(false)
  })
})
