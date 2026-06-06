import { describe, it, expect } from "vitest"
import { splitResolvePools, BLOCKING_RESOLVE_CAP, SECONDARY_RESOLVE_CAP } from "./resolve-pools"

const names = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`)

describe("splitResolvePools", () => {
  it("blocking slice is capped at BLOCKING_RESOLVE_CAP", () => {
    const { blocking } = splitResolvePools(names(200))
    expect(blocking).toHaveLength(BLOCKING_RESOLVE_CAP)
    expect(blocking[0]).toBe("a0")
  })

  it("secondary continues immediately after blocking with no gap and no overlap", () => {
    const { blocking, secondary } = splitResolvePools(names(200))
    expect(secondary[0]).toBe(`a${BLOCKING_RESOLVE_CAP}`)
    expect(secondary).toHaveLength(SECONDARY_RESOLVE_CAP)
    expect([...blocking, ...secondary]).toEqual(names(BLOCKING_RESOLVE_CAP + SECONDARY_RESOLVE_CAP))
  })

  it("coverage equals the legacy 90-name window (no recs dropped)", () => {
    const { blocking, secondary } = splitResolvePools(names(200))
    const covered = new Set([...blocking, ...secondary])
    expect(covered.size).toBe(BLOCKING_RESOLVE_CAP + SECONDARY_RESOLVE_CAP)
    expect(BLOCKING_RESOLVE_CAP + SECONDARY_RESOLVE_CAP).toBe(90)
  })

  it("handles short lists without overrun", () => {
    const { blocking, secondary } = splitResolvePools(names(10))
    expect(blocking).toEqual(names(10))
    expect(secondary).toEqual([])
  })
})
