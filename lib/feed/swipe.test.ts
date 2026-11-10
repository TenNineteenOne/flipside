import { describe, it, expect } from "vitest"
import { swipeDirection } from "./swipe"

describe("swipeDirection", () => {
  it("commits past 96px either way, whatever the speed", () => {
    expect(swipeDirection(97, 0)).toBe(1)
    expect(swipeDirection(-97, 0)).toBe(-1)
  })
  it("springs back at or under the threshold when slow", () => {
    expect(swipeDirection(96, 0)).toBe(0)
    expect(swipeDirection(-60, -100)).toBe(0)
    expect(swipeDirection(0, 0)).toBe(0)
  })
  it("a fast flick past 40px commits", () => {
    expect(swipeDirection(41, 501)).toBe(1)
    expect(swipeDirection(-41, -501)).toBe(-1)
  })
  it("a fast flick under 40px, or against the drag direction, does not", () => {
    expect(swipeDirection(40, 900)).toBe(0)
    expect(swipeDirection(60, -900)).toBe(0)
    expect(swipeDirection(-60, 900)).toBe(0)
  })
})
