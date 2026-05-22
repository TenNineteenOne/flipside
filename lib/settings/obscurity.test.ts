import { describe, it, expect } from "vitest"
import { obscurityLabel, obscurityHelp, obscurityColor, MINT, BLUE, ACCENT, AMBER } from "./obscurity"

describe("obscurityLabel", () => {
  it("returns 'Deep underground' for t < 5", () => {
    expect(obscurityLabel(0)).toBe("Deep underground")
    expect(obscurityLabel(4)).toBe("Deep underground")
  })
  it("returns 'Offbeat' for 5 <= t < 15", () => {
    expect(obscurityLabel(5)).toBe("Offbeat")
    expect(obscurityLabel(14)).toBe("Offbeat")
  })
  it("returns 'Curious' for 15 <= t < 30", () => {
    expect(obscurityLabel(15)).toBe("Curious")
    expect(obscurityLabel(29)).toBe("Curious")
  })
  it("returns 'Familiar' for t >= 30", () => {
    expect(obscurityLabel(30)).toBe("Familiar")
    expect(obscurityLabel(50)).toBe("Familiar")
  })
})

describe("obscurityHelp", () => {
  it("deep underground bucket", () => {
    expect(obscurityHelp(0)).toContain("Almost nothing")
  })
  it("offbeat bucket", () => {
    expect(obscurityHelp(10)).toContain("Mostly unfamiliar")
  })
  it("curious bucket", () => {
    expect(obscurityHelp(20)).toContain("balanced mix")
  })
  it("familiar bucket", () => {
    expect(obscurityHelp(35)).toContain("already play often")
  })
})

describe("obscurityColor", () => {
  it("MINT for t < 5", () => {
    expect(obscurityColor(0)).toBe(MINT)
    expect(obscurityColor(4)).toBe(MINT)
  })
  it("BLUE for 5 <= t < 15", () => {
    expect(obscurityColor(5)).toBe(BLUE)
    expect(obscurityColor(14)).toBe(BLUE)
  })
  it("ACCENT for 15 <= t < 30", () => {
    expect(obscurityColor(15)).toBe(ACCENT)
    expect(obscurityColor(29)).toBe(ACCENT)
  })
  it("AMBER for t >= 30", () => {
    expect(obscurityColor(30)).toBe(AMBER)
    expect(obscurityColor(50)).toBe(AMBER)
  })
})
