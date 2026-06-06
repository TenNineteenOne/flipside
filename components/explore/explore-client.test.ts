/**
 * Unit tests for pure helpers exported from explore-client.tsx.
 * No DOM / React rendering — these functions are fully synchronous / testable.
 */
import { describe, it, expect } from "vitest"
import { hasRegenCompleted, POLL_CEILING_MS, POLL_INTERVAL_MS } from "./explore-client"

describe("hasRegenCompleted", () => {
  it("returns false when latest is null (nothing in cache yet)", () => {
    expect(hasRegenCompleted("2026-06-06T12:00:00Z", null)).toBe(false)
    expect(hasRegenCompleted(null, null)).toBe(false)
  })

  it("returns true when captured is null (cold start — any value counts)", () => {
    expect(hasRegenCompleted(null, "2026-06-06T12:00:00Z")).toBe(true)
  })

  it("returns false when latest <= captured (no new write yet)", () => {
    expect(
      hasRegenCompleted("2026-06-06T12:00:00Z", "2026-06-06T12:00:00Z"),
    ).toBe(false)
  })

  it("returns false when latest is strictly earlier than captured (shouldn't happen; guard)", () => {
    expect(
      hasRegenCompleted("2026-06-06T12:00:01Z", "2026-06-06T12:00:00Z"),
    ).toBe(false)
  })

  it("returns true when latest is strictly after captured (regen done)", () => {
    expect(
      hasRegenCompleted("2026-06-06T12:00:00Z", "2026-06-06T12:00:05Z"),
    ).toBe(true)
  })

  it("handles ISO strings with different precision correctly", () => {
    expect(
      hasRegenCompleted(
        "2026-06-06T12:00:00.000Z",
        "2026-06-06T12:00:00.001Z",
      ),
    ).toBe(true)
  })
})

describe("polling constants", () => {
  it("POLL_CEILING_MS is at least 90 seconds", () => {
    expect(POLL_CEILING_MS).toBeGreaterThanOrEqual(90_000)
  })

  it("POLL_INTERVAL_MS is a positive number and less than POLL_CEILING_MS", () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThan(0)
    expect(POLL_INTERVAL_MS).toBeLessThan(POLL_CEILING_MS)
  })
})
