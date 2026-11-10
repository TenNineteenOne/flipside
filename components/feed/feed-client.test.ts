import { describe, it, expect, vi, beforeEach } from "vitest"

const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a) }) }))

import { flipWander } from "./feed-client"
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
