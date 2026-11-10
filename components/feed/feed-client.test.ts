import { describe, it, expect, vi, beforeEach } from "vitest"

const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a) }) }))

import { flipWander, queueWander } from "./feed-client"
import { patchAdventurousSetting } from "@/lib/hooks/use-adventurous-mode"

describe("flipWander (the Feed's Wander farther switch)", () => {
  beforeEach(() => toastError.mockClear())

  it("only saves the setting: one PATCH /api/settings, no generate or rebuild request", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchSpy)
    await flipWander(false, patchAdventurousSetting)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/settings")
    expect(JSON.parse(init.body as string)).toEqual({ adventurous: true })
    vi.unstubAllGlobals()
  })

  it("a failed save toasts and resolves (a Load more waiting on it still runs)", async () => {
    await expect(flipWander(true, async () => { throw new Error("nope") })).resolves.toBeUndefined()
    expect(toastError).toHaveBeenCalledWith("Couldn't save Wander farther")
  })
})

describe("queueWander (rapid double toggle)", () => {
  beforeEach(() => toastError.mockClear())

  it("saves in click order even when the first save is slower; a failed save doesn't break the chain", async () => {
    const order: string[] = []
    let finishFirst!: () => void
    let calls = 0
    const save = vi.fn((next: boolean) => {
      const n = ++calls
      order.push(`start${n} ${next}`)
      if (n === 1) return new Promise<void>((r) => { finishFirst = () => { order.push("end1"); r() } })
      if (n === 2) return Promise.reject(new Error("nope"))
      return Promise.resolve()
    })
    const first = queueWander(Promise.resolve(), false, save)
    const second = queueWander(first, true, save)
    const third = queueWander(second, false, save)
    await new Promise((r) => setTimeout(r, 0))
    expect(order).toEqual(["start1 true"])
    finishFirst()
    await third
    expect(order).toEqual(["start1 true", "end1", "start2 false", "start3 true"])
    expect(toastError).toHaveBeenCalledTimes(1)
  })
})
