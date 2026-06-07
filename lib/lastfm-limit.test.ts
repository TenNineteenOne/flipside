import { describe, it, expect } from "vitest"
import { TokenBucket, createLastfmLimiter, runLastfm } from "./lastfm-limit"

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("TokenBucket", () => {
  it("starts full and allows a burst up to capacity", () => {
    const b = new TokenBucket(4, 4, () => 0)
    expect(b.tryConsume(0)).toBe(true)
    expect(b.tryConsume(0)).toBe(true)
    expect(b.tryConsume(0)).toBe(true)
    expect(b.tryConsume(0)).toBe(true)
    // 5th in the same instant is denied — bucket empty.
    expect(b.tryConsume(0)).toBe(false)
  })

  it("refills continuously at ratePerSec", () => {
    const b = new TokenBucket(4, 4, () => 0)
    for (let i = 0; i < 4; i++) b.tryConsume(0) // drain
    expect(b.tryConsume(0)).toBe(false)
    // 4 tokens/sec => 1 token every 250ms.
    expect(b.tryConsume(249)).toBe(false)
    expect(b.tryConsume(250)).toBe(true)
    expect(b.tryConsume(250)).toBe(false) // consumed the one that refilled
    expect(b.tryConsume(500)).toBe(true)
  })

  it("never accumulates beyond capacity", () => {
    const b = new TokenBucket(4, 4, () => 0)
    for (let i = 0; i < 4; i++) b.tryConsume(0) // drain to 0
    // Idle for 10s — would refill 40 tokens, but capacity caps at 4.
    expect(b.tryConsume(10_000)).toBe(true)
    expect(b.tryConsume(10_000)).toBe(true)
    expect(b.tryConsume(10_000)).toBe(true)
    expect(b.tryConsume(10_000)).toBe(true)
    expect(b.tryConsume(10_000)).toBe(false)
  })

  it("msUntilNext reports 0 when a token is available, else the deficit wait", () => {
    const b = new TokenBucket(4, 4, () => 0)
    expect(b.msUntilNext(0)).toBe(0) // full
    for (let i = 0; i < 4; i++) b.tryConsume(0) // drain
    // Empty: need 1 token at 4/s => 250ms.
    expect(b.msUntilNext(0)).toBe(250)
    // 125ms elapsed => 0.5 token; 0.5 more needed => 125ms.
    expect(b.msUntilNext(125)).toBe(125)
  })

  it("supports a fractional sustained rate", () => {
    const b = new TokenBucket(1, 2, () => 0) // 2/sec => 500ms/token
    expect(b.tryConsume(0)).toBe(true)
    expect(b.tryConsume(0)).toBe(false)
    expect(b.tryConsume(499)).toBe(false)
    expect(b.tryConsume(500)).toBe(true)
  })
})

/**
 * Fake clock + clock-advancing sleep. `sleep(ms)` advances a shared virtual
 * clock and records the wait. Rate assertions are made on the RECORDED SLEEPS
 * (the actual throttle behavior) rather than on timestamps read inside the
 * tasks — task bodies run in later microtasks, by which point the shared clock
 * may already have advanced, so per-task `now()` is not a reliable admission
 * stamp. Total slept time IS deterministic and is the true rate signal.
 */
function fakeTime() {
  let t = 0
  const sleeps: number[] = []
  return {
    now: () => t,
    elapsed: () => t,
    sleeps,
    sleep: (ms: number) => {
      sleeps.push(ms)
      t += ms
      return Promise.resolve()
    },
  }
}

describe("createLastfmLimiter — rate limiting", () => {
  it("admits a burst up to capacity for free, then throttles each further call by 1/rate", async () => {
    const ft = fakeTime()
    const limiter = createLastfmLimiter({
      capacity: 4,
      ratePerSec: 4, // 250ms / token after the burst
      maxConcurrency: 100, // high — isolate the rate gate, not the slot gate
      now: ft.now,
      sleep: ft.sleep,
    })

    const N = 8
    let ran = 0
    await Promise.all(Array.from({ length: N }, () => limiter.run(async () => { ran++ })))

    expect(ran).toBe(N) // every call ran
    // First `capacity` admitted for free; the remaining (N - capacity) each
    // waited exactly one token-interval (1000/rate = 250ms).
    expect(ft.sleeps).toEqual([250, 250, 250, 250])
    // Sustained-rate invariant: total virtual time to admit N == (N-cap)/rate.
    expect(ft.elapsed()).toBe(((N - 4) / 4) * 1000) // 1000ms
  })

  it("holds the sustained rate at the target under a large burst", async () => {
    const ft = fakeTime()
    const limiter = createLastfmLimiter({ capacity: 4, ratePerSec: 4, maxConcurrency: 100, now: ft.now, sleep: ft.sleep })

    const N = 20
    await Promise.all(Array.from({ length: N }, () => limiter.run(async () => {})))

    // (N - capacity) throttled admissions, each a single 250ms wait => the
    // effective sustained rate is exactly `rate` req/s, never above.
    expect(ft.sleeps.length).toBe(N - 4)
    expect(ft.sleeps.every((ms) => ms === 250)).toBe(true)
    const totalMs = ft.elapsed()
    const sustainedRate = (N - 4) / (totalMs / 1000)
    expect(sustainedRate).toBeLessThanOrEqual(4)
  })
})

describe("createLastfmLimiter — concurrency", () => {
  it("never exceeds maxConcurrency in-flight", async () => {
    // Rate gate disabled (huge bucket) so only the concurrency cap is exercised.
    const limiter = createLastfmLimiter({ capacity: 1e9, ratePerSec: 1e9, maxConcurrency: 3 })

    let inFlight = 0
    let peak = 0
    const gates: Array<() => void> = []
    const blockingFn = () =>
      new Promise<void>((resolve) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        gates.push(() => {
          inFlight--
          resolve()
        })
      })

    const runs = Array.from({ length: 10 }, () => limiter.run(blockingFn))

    // Let the first wave admit, then assert the cap held.
    await tick()
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(0)

    // Drain: release one parked task at a time; each release admits the next
    // waiter (which pushes a fresh gate), so peak must never exceed the cap.
    while (gates.length > 0) {
      gates.shift()!()
      await tick()
    }
    await Promise.all(runs)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it("releases the slot even when the task throws, so later tasks still run", async () => {
    const limiter = createLastfmLimiter({ capacity: 1e9, ratePerSec: 1e9, maxConcurrency: 4 })
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        limiter.run(async () => {
          if (i % 2 === 0) throw new Error(`boom ${i}`)
          return i
        }),
      ),
    )
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(10)
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(10)
    // A fresh task after a wave of failures must still acquire a slot.
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok")
  })
})

describe("runLastfm (production singleton)", () => {
  it("runs and returns results within the burst capacity (no rate wait)", async () => {
    // ≤ capacity calls => admitted instantly, exercising the real exported gate.
    const results = await Promise.all([
      runLastfm(async () => 1),
      runLastfm(async () => 2),
      runLastfm(async () => 3),
    ])
    expect(results.sort()).toEqual([1, 2, 3])
  })
})
