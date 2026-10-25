import { describe, it, expect } from "vitest"
import { createLimiter } from "./limiter"

// Concurrency/token-bucket behavior is covered via itunes-limit.test.ts and
// lastfm/limit.test.ts, which exercise the instances built on this factory.

/** Fake clock whose sleep advances time instantly and records each wait. */
function fakeTime(start = 1_000) {
  let t = start
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
    advance: (ms: number) => (t += ms),
    sleeps,
  }
}

describe("createLimiter min-interval", () => {
  it("lets the first call through immediately and delays a call inside the gap", async () => {
    const clock = fakeTime()
    const lim = createLimiter({ maxConcurrency: 5, minIntervalMs: 50, now: clock.now, sleep: clock.sleep })
    await lim.run(async () => 1)
    expect(clock.sleeps).toEqual([])
    clock.advance(20)
    await lim.run(async () => 2)
    expect(clock.sleeps).toEqual([30])
  })

  it("does not wait once the gap has elapsed", async () => {
    const clock = fakeTime()
    const lim = createLimiter({ maxConcurrency: 5, minIntervalMs: 50, now: clock.now, sleep: clock.sleep })
    await lim.run(async () => 1)
    clock.advance(50)
    await lim.run(async () => 2)
    expect(clock.sleeps).toEqual([])
  })

  it("no interval configured = no sleeps", async () => {
    const clock = fakeTime()
    const lim = createLimiter({ maxConcurrency: 5, now: clock.now, sleep: clock.sleep })
    await Promise.all([lim.run(async () => 1), lim.run(async () => 2)])
    expect(clock.sleeps).toEqual([])
  })
})
