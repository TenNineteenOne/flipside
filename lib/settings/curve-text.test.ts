import { describe, it, expect } from "vitest"
import { curveLabel, curveHelp } from "./curve-text"

describe("curveLabel", () => {
  it("'Niche only' for k < 0.92", () => {
    expect(curveLabel(0.90)).toBe("Niche only")
    expect(curveLabel(0.919)).toBe("Niche only")
  })
  it("'Mostly niche' for 0.92 <= k < 0.95", () => {
    expect(curveLabel(0.92)).toBe("Mostly niche")
    expect(curveLabel(0.94)).toBe("Mostly niche")
  })
  it("'Balanced' for 0.95 <= k < 0.97", () => {
    expect(curveLabel(0.95)).toBe("Balanced")
    expect(curveLabel(0.969)).toBe("Balanced")
  })
  it("'Mostly popular' for 0.97 <= k < 0.99", () => {
    expect(curveLabel(0.97)).toBe("Mostly popular")
    expect(curveLabel(0.989)).toBe("Mostly popular")
  })
  it("'Mainstream' for k >= 0.99", () => {
    expect(curveLabel(0.99)).toBe("Mainstream")
    expect(curveLabel(1.0)).toBe("Mainstream")
  })
})

describe("curveHelp", () => {
  it("niche-only bucket", () => {
    expect(curveHelp(0.90)).toContain("steepest curve")
  })
  it("mostly-niche bucket", () => {
    expect(curveHelp(0.93)).toContain("strongly preferred")
  })
  it("balanced bucket", () => {
    expect(curveHelp(0.96)).toContain("Default mix")
  })
  it("mostly-popular bucket", () => {
    expect(curveHelp(0.98)).toContain("Popularity barely hurts")
  })
  it("mainstream bucket", () => {
    expect(curveHelp(1.0)).toContain("curve flattens")
  })
})
