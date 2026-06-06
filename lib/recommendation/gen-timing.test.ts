import { describe, it, expect } from "vitest"
import { formatGenTiming } from "./gen-timing"

describe("formatGenTiming", () => {
  it("renders a single-line structured log with rounded ms", () => {
    const line = formatGenTiming({
      userId: "u1",
      phases: { gather: 812.4, primary: 2940.9 },
      totalMs: 3810.2,
      misses: 24,
      retries: 1,
      rateLimited: false,
    })
    expect(line).toBe(
      "[gen-timing] user=u1 gather=812 primary=2941 total=3810 misses=24 retries=1 rl=false"
    )
  })

  it("omits absent phases and defaults counters to 0", () => {
    const line = formatGenTiming({ userId: "u2", phases: {}, totalMs: 100.6 })
    expect(line).toBe("[gen-timing] user=u2 total=101 misses=0 retries=0 rl=false")
  })

  it("appends itunesCalls and spotifyCalls when provided", () => {
    const line = formatGenTiming({
      userId: "u3",
      phases: { primary: 1200, preview: 400 },
      totalMs: 2000,
      misses: 5,
      retries: 0,
      rateLimited: false,
      itunesCalls: 18,
      spotifyCalls: 42,
    })
    expect(line).toBe(
      "[gen-timing] user=u3 primary=1200 preview=400 total=2000 misses=5 retries=0 rl=false itunesCalls=18 spotifyCalls=42"
    )
  })

  it("omits call fields cleanly when not provided", () => {
    const line = formatGenTiming({
      userId: "u4",
      phases: { primary: 500 },
      totalMs: 800,
    })
    // Should not contain itunesCalls or spotifyCalls tokens
    expect(line).not.toContain("itunesCalls")
    expect(line).not.toContain("spotifyCalls")
    expect(line).toBe("[gen-timing] user=u4 primary=500 total=800 misses=0 retries=0 rl=false")
  })

  it("renders zero call counts when explicitly set to 0", () => {
    const line = formatGenTiming({
      userId: "u5",
      phases: {},
      totalMs: 100,
      itunesCalls: 0,
      spotifyCalls: 0,
    })
    expect(line).toBe("[gen-timing] user=u5 total=100 misses=0 retries=0 rl=false itunesCalls=0 spotifyCalls=0")
  })
})
