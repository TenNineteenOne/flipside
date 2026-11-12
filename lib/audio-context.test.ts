import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createThrottle } from "./audio-context"

describe("createThrottle (playback progress ticks)", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("reports the first tick at once and folds ticks inside the window into one trailing report", () => {
    const report = vi.fn()
    const t = createThrottle(report, 250)
    t.tick()
    expect(report).toHaveBeenCalledTimes(1)
    t.tick()
    t.tick()
    expect(report).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(250)
    expect(report).toHaveBeenCalledTimes(2) // the last value (e.g. a pause) is not dropped
    vi.advanceTimersByTime(1000)
    expect(report).toHaveBeenCalledTimes(2)
  })

  it("cancel drops the pending trailing report and frees the next tick", () => {
    const report = vi.fn()
    const t = createThrottle(report, 250)
    t.tick()
    t.tick()
    t.cancel()
    vi.advanceTimersByTime(250)
    expect(report).toHaveBeenCalledTimes(1)
    t.tick()
    expect(report).toHaveBeenCalledTimes(2)
  })
})
