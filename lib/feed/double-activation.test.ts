import { describe, it, expect } from "vitest"
import { activationStamp, isDoubleActivation } from "./double-activation"

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

describe("activationStamp", () => {
  const last = { artistId: "a", at: 1000 }
  it("starts a new window only when the decision moved the selection on", () => {
    expect(activationStamp(last, "b", "b", "c", 2000)).toEqual({ artistId: "b", at: 2000 })
  })
  it("keeps the previous stamp for a decision that left the selection where it was (un-like)", () => {
    expect(activationStamp(last, "b", "b", "b", 2000)).toBe(last)
    expect(activationStamp(null, "b", "b", "b", 2000)).toBeNull()
  })
  it("so an un-like does not block deciding the next artist right after", () => {
    const after = activationStamp(null, "b", "b", "b", 2000) // un-like b, selection stays on b
    expect(isDoubleActivation(after, "c", true, 2100)).toBe(false)
  })
})
