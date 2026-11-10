import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createPoller, FINAL_GET_RETRY_MS } from "./poll"

const MS = 1000

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("createPoller", () => {
  it("ticks every interval until check resolves true, then stops with onStop(true)", async () => {
    const check = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const onStop = vi.fn()
    createPoller({ intervalMs: MS, check, onStop }).start(Date.now() + 60_000)
    await vi.advanceTimersByTimeAsync(MS * 5)
    expect(check).toHaveBeenCalledTimes(2)
    expect(onStop).toHaveBeenCalledExactlyOnceWith(true)
  })

  it("swallows a throw before the deadline and keeps polling", async () => {
    const check = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(false)
    createPoller({ intervalMs: MS, check }).start(Date.now() + 60_000)
    await vi.advanceTimersByTimeAsync(MS * 3)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it("skips ticks while a check is in flight", async () => {
    const check = vi.fn(() => new Promise<boolean>(() => {}))
    createPoller({ intervalMs: MS, check }).start(Date.now() + 60_000)
    await vi.advanceTimersByTimeAsync(MS * 4)
    expect(check).toHaveBeenCalledTimes(1)
  })

  it("past the deadline checks once more, then stops with onStop(false)", async () => {
    let t = 0
    const check = vi.fn().mockResolvedValue(false)
    const onStop = vi.fn()
    createPoller({ intervalMs: MS, check, onStop, now: () => t }).start(5_000)
    t = 70_000 // frozen tab resumes past the ceiling
    await vi.advanceTimersByTimeAsync(MS * 4)
    expect(check).toHaveBeenCalledTimes(1)
    expect(onStop).toHaveBeenCalledExactlyOnceWith(false)
  })

  it("retries a thrown final check once after FINAL_GET_RETRY_MS", async () => {
    let t = 0
    const check = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(true)
    const onStop = vi.fn()
    createPoller({ intervalMs: MS, check, onStop, now: () => t }).start(0)
    t = 1
    await vi.advanceTimersByTimeAsync(MS)
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FINAL_GET_RETRY_MS)
    expect(check).toHaveBeenCalledTimes(2)
    expect(onStop).toHaveBeenCalledExactlyOnceWith(true)
  })

  it("a superseded run's late result is ignored and isLive() reports it", async () => {
    let resolveOld: (v: boolean) => void = () => {}
    const seenLive: boolean[] = []
    const check = vi.fn()
      .mockImplementationOnce((isLive: () => boolean) => new Promise<boolean>((r) => { resolveOld = (v) => { seenLive.push(isLive()); r(v) } }))
      .mockResolvedValue(false)
    const onStop = vi.fn()
    const poller = createPoller({ intervalMs: MS, check, onStop })
    poller.start(Date.now() + 60_000)
    await vi.advanceTimersByTimeAsync(MS) // old check in flight
    poller.start(Date.now() + 60_000)
    resolveOld(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(seenLive).toEqual([false])
    expect(onStop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(MS)
    expect(check).toHaveBeenCalledTimes(2) // new run not blocked by the old in-flight check
  })

  it("stop() halts ticks without calling onStop", async () => {
    const check = vi.fn().mockResolvedValue(false)
    const onStop = vi.fn()
    const poller = createPoller({ intervalMs: MS, check, onStop })
    poller.start(Date.now() + 60_000)
    await vi.advanceTimersByTimeAsync(MS)
    poller.stop()
    await vi.advanceTimersByTimeAsync(MS * 3)
    expect(check).toHaveBeenCalledTimes(1)
    expect(onStop).not.toHaveBeenCalled()
  })
})
