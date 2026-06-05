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
})
