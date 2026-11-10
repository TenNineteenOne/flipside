import { describe, expect, it } from "vitest"
import { identiconSvg } from "./identicon"

/** Well-formed check: every tag closes in order, and only the expected elements appear. */
function wellFormed(svg: string): boolean {
  const stack: string[] = []
  for (const [, close, name, selfClose] of svg.matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/g)) {
    if (!["svg", "g", "rect", "circle", "path"].includes(name)) return false
    if (close) { if (stack.pop() !== name) return false }
    else if (!selfClose) stack.push(name)
  }
  return stack.length === 0
}

describe("identiconSvg", () => {
  it("is deterministic per seed and differs between seeds", () => {
    expect(identiconSvg("user-1", 30)).toBe(identiconSvg("user-1", 30))
    const seeds = Array.from({ length: 50 }, (_, i) => identiconSvg(`7f3c-${i}`, 30))
    expect(new Set(seeds).size).toBe(50)
  })

  it("produces well-formed SVG with finite numbers and the requested size", () => {
    for (const seed of ["", "a", "dev-preview-user", "0b7a0c1e-1d4f-4c55-9a39-2f0b6c3e8d11"]) {
      const svg = identiconSvg(seed, 48)
      expect(wellFormed(svg)).toBe(true)
      expect(svg).toContain('width="48" height="48"')
      expect(svg).not.toMatch(/NaN|undefined|Infinity/)
      // background plus three shapes, never the background colour
      const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])
      expect(fills).toHaveLength(4)
      expect(fills.slice(1)).not.toContain(fills[0])
    }
  })
})
