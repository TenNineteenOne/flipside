import { describe, it, expect } from "vitest"
import { runItunes } from "./itunes-limit"

/**
 * The limiter bounds concurrent live iTunes calls (bursty preview confirmation
 * across the blocking set + 4 Explore rails + per-artist tracks must share one
 * budget). These lock down the hand-written slot-transfer semaphore: it must cap
 * concurrency and never lose/leak a slot.
 */
describe("runItunes concurrency gate", () => {
  it("never runs more than the cap concurrently and completes every task", async () => {
    let active = 0
    let peak = 0
    const deferredResolve = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const tasks = Array.from({ length: 40 }, (_, i) =>
      runItunes(async () => {
        active++
        peak = Math.max(peak, active)
        await deferredResolve(5 + (i % 3))
        active--
        return i
      }),
    )

    const results = await Promise.all(tasks)

    expect(results).toHaveLength(40)
    expect(results.sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i))
    expect(peak).toBeLessThanOrEqual(12) // MAX_CONCURRENCY
    expect(peak).toBeGreaterThan(1) // actually ran in parallel, not serialized
    expect(active).toBe(0) // every slot released
  })

  it("releases the slot even when the task throws, so later tasks still run", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        runItunes(async () => {
          if (i % 2 === 0) throw new Error(`boom ${i}`)
          return i
        }),
      ),
    )

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(10)
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(10)

    // A fresh task after a wave of failures must still acquire a slot.
    await expect(runItunes(async () => "ok")).resolves.toBe("ok")
  })
})
