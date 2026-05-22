import { describe, it, expect, vi, afterEach } from "vitest"
import { regenerateFeedAndExplore } from "./regenerate"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function makeOpts() {
  let generating = false
  return {
    get isGenerating() { return generating },
    setGenerating: vi.fn((b: boolean) => { generating = b }),
  }
}

describe("regenerateFeedAndExplore", () => {
  it("no-ops when isGenerating is true", async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal("fetch", mockFetch)

    const opts = { isGenerating: true, setGenerating: vi.fn() }
    await regenerateFeedAndExplore(opts)

    expect(mockFetch).not.toHaveBeenCalled()
    expect(opts.setGenerating).not.toHaveBeenCalled()
  })

  it("calls both endpoints in parallel when not generating", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })
    vi.stubGlobal("fetch", mockFetch)

    const opts = makeOpts()
    await regenerateFeedAndExplore(opts)

    const urls = mockFetch.mock.calls.map((args: unknown[]) => args[0] as string)
    expect(urls).toContain("/api/recommendations/generate?replace=true")
    expect(urls).toContain("/api/explore/generate?force=true")
  })

  it("toasts success when both succeed", async () => {
    const { toast } = await import("sonner")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }))

    const opts = makeOpts()
    await regenerateFeedAndExplore(opts)

    expect(toast.success).toHaveBeenCalledWith("Feed & Explore rebuilt")
  })

  it("toasts 'Couldn't rebuild' when both fail", async () => {
    const { toast } = await import("sonner")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }))

    const opts = makeOpts()
    await regenerateFeedAndExplore(opts)

    expect(toast.error).toHaveBeenCalledWith("Couldn't rebuild — try again")
  })

  it("toasts explore-specific failure when only explore fails", async () => {
    const { toast } = await import("sonner")
    let callCount = 0
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++
      // first call = feed (ok), second = explore (fail)
      return Promise.resolve({
        ok: callCount === 1,
        status: callCount === 1 ? 200 : 500,
        json: () => Promise.resolve({}),
      })
    }))

    const opts = makeOpts()
    await regenerateFeedAndExplore(opts)

    expect(toast.error).toHaveBeenCalledWith("Feed rebuilt, but Explore failed")
  })

  it("sets generating false after completion (finally block)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }))

    const opts = makeOpts()
    await regenerateFeedAndExplore(opts)

    // Last setGenerating call must set it to false
    const calls = opts.setGenerating.mock.calls as Array<[boolean]>
    expect(calls[calls.length - 1][0]).toBe(false)
  })

  it("includes 429 cooldown message in feed failure toast", async () => {
    const { toast } = await import("sonner")
    let callCount = 0
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++
      const isFeed = callCount === 1
      return Promise.resolve({
        ok: false,
        status: isFeed ? 429 : 200,
        json: () => Promise.resolve({ error: "" }),
      })
    }))

    // Both fail — but feed's 429 path fires describeFeedFailure only when
    // explore is ok. Let explore succeed on second call.
    let c2 = 0
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      c2++
      if (c2 === 1) return Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: "" }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))

    const opts = makeOpts()
    await regenerateFeedAndExplore(opts)

    expect(toast.error).toHaveBeenCalledWith("Cooling down — wait a few seconds and try again")
  })
})
