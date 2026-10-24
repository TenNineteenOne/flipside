import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createRailSession,
  orderRails,
  resolveActiveKey,
  EXPLORE_REGEN_AT_KEY,
  POLL_CEILING_MS,
  POLL_INTERVAL_MS,
  type RailSessionDeps,
} from "./rail-session"
import type { RailKey, RailPayload } from "@/lib/recommendation/explore-rail-payloads"
import type { CardArtist } from "@/lib/cards/card-artist"

function artist(id: string): CardArtist {
  return { id, name: id, genres: [], imageUrl: null, popularity: 0, topTracks: [], artistColor: null, why: { sourceArtists: [], genres: [] } }
}
function rail(railKey: RailKey, n = 5, prefix: string = railKey): RailPayload {
  return { railKey, title: railKey, subtitle: "", artists: Array.from({ length: n }, (_, i) => artist(`${prefix}-${i}`)) }
}
const ALL = [rail("adjacent"), rail("outside"), rail("wildcards"), rail("leftfield")]

function json(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response
}

function setup(overrides: Partial<RailSessionDeps> = {}) {
  const toast = Object.assign(vi.fn(), { error: vi.fn() })
  const dropThumbsUp = vi.fn()
  const clearSignals = vi.fn()
  const storage = { getItem: vi.fn(() => null as string | null), removeItem: vi.fn() }
  const fetchImpl = vi.fn()
  const session = createRailSession({
    initialRails: ALL,
    initialGeneratedAt: "2026-10-01T00:00:00Z",
    initialAdventurous: false,
    fetchImpl,
    storage,
    toast,
    persistAdventurous: vi.fn().mockResolvedValue(undefined),
    dropThumbsUp,
    clearSignals,
    ...overrides,
  })
  return { session, toast, dropThumbsUp, clearSignals, storage, fetchImpl }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("ordering + activeKey rule", () => {
  it("orders by adventurous mode and hides thin rails", () => {
    const rails = [...ALL.slice(0, 3), rail("leftfield", 4)]
    expect(orderRails(rails, false).map((r) => r.railKey)).toEqual(["adjacent", "wildcards", "outside"])
    expect(orderRails(rails, true).map((r) => r.railKey)).toEqual(["outside", "wildcards", "adjacent"])
  })

  it("resolveActiveKey keeps a visible key, else falls back to the first visible rail", () => {
    const ordered = orderRails(ALL, false)
    expect(resolveActiveKey(ordered, "outside")).toBe("outside")
    expect(resolveActiveKey(ordered.slice(2), "adjacent")).toBe("outside")
    expect(resolveActiveKey([], "wildcards")).toBe("wildcards")
  })

  it("adventurous reorder keeps a still-visible active rail (B5)", () => {
    const { session } = setup({ initialRails: [...ALL.slice(0, 3), rail("leftfield", 2)] })
    expect(session.getState().activeKey).toBe("adjacent")
    session.select("outside")
    session.setAdventurous(true)
    expect(session.getState().activeKey).toBe("outside") // still visible
    expect(session.getState().orderedRails[0].railKey).toBe("outside")
  })

  it("starts on the first visible rail and select() changes it", () => {
    const { session } = setup({ initialAdventurous: true })
    expect(session.getState().activeKey).toBe("outside")
    session.select("wildcards")
    expect(session.getState().activeRail?.railKey).toBe("wildcards")
  })
})

describe("shuffle + poll swap", () => {
  it("swap lands while the user is on rail X: X kept when still visible, dropped → first visible", async () => {
    const { session, fetchImpl } = setup()
    session.select("leftfield")
    fetchImpl
      .mockResolvedValueOnce(json(200)) // POST generate
      .mockResolvedValueOnce(json(200, { rails: ALL, generatedAt: "2026-10-01T00:00:00Z" })) // not advanced
      .mockResolvedValueOnce(json(200, { rails: [rail("adjacent", 5, "new"), rail("leftfield", 2)], generatedAt: "2026-10-02T00:00:00Z" }))
    await session.shuffle()
    expect(session.getState().isRegenerating).toBe(true)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(session.getState().rails).toBe(ALL)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    const s = session.getState()
    expect(s.rails[0].artists[0].id).toBe("new-0")
    expect(s.activeKey).toBe("adjacent") // leftfield fell under MIN_PICKS
    expect(s.isRegenerating).toBe(false)
  })

  it("drops thumbs_up for the rail active when the POST resolves, not when tapped (B4)", async () => {
    const { session, fetchImpl, dropThumbsUp } = setup()
    let resolvePost: (r: Response) => void = () => {}
    fetchImpl.mockReturnValueOnce(new Promise<Response>((r) => { resolvePost = r }))
    const p = session.shuffle()
    session.select("wildcards") // user switches tab while POST in flight
    resolvePost(json(200))
    await p
    expect(dropThumbsUp).toHaveBeenCalledWith(ALL[2].artists.map((a) => a.id))
    session.dispose()
  })

  it("shuffle re-entry is guarded; a failed POST toasts and settles", async () => {
    const { session, fetchImpl, toast } = setup()
    fetchImpl.mockResolvedValueOnce(json(500))
    const p = session.shuffle()
    await session.shuffle()
    await p
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith("Couldn't start rebuild — try again")
    expect(session.getState().isRegenerating).toBe(false)
  })

  it("poll timeout: soft toast and settle after the ceiling", async () => {
    const { session, fetchImpl, toast } = setup()
    fetchImpl.mockImplementation((url: string) =>
      Promise.resolve(url.includes("generate") ? json(200) : json(200, { rails: ALL, generatedAt: "2026-10-01T00:00:00Z" })),
    )
    await session.shuffle()
    await vi.advanceTimersByTimeAsync(POLL_CEILING_MS + POLL_INTERVAL_MS)
    expect(toast).toHaveBeenCalledWith("Still building — refresh in a moment", { duration: 4000 })
    expect(session.getState().isRegenerating).toBe(false)
    const calls = fetchImpl.mock.calls.length
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(fetchImpl.mock.calls.length).toBe(calls) // stopped
  })
})

describe("adventurous toggle + apply", () => {
  it("toggle persists the flip and marks dirty; apply clears signals and dirty", async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const { session, fetchImpl, clearSignals } = setup({ persistAdventurous: persist })
    await session.toggleAdventurous()
    expect(persist).toHaveBeenCalledWith(true)
    expect(session.getState().isAdvDirty).toBe(true)
    fetchImpl.mockResolvedValueOnce(json(200))
    await session.applyAdventurous()
    expect(clearSignals).toHaveBeenCalled()
    expect(session.getState()).toMatchObject({ isAdvDirty: false, isApplyingAdv: true })
    session.dispose()
  })

  it("a failed toggle toasts and stays clean", async () => {
    const { session, toast } = setup({ persistAdventurous: vi.fn().mockRejectedValue(new Error("x")) })
    await session.toggleAdventurous()
    expect(toast.error).toHaveBeenCalledWith("Couldn't toggle — try again")
    expect(session.getState()).toMatchObject({ isAdvDirty: false, isTogglingAdv: false })
  })
})

describe("start()", () => {
  it("cold start POSTs a regen once", async () => {
    const { session, fetchImpl } = setup()
    fetchImpl.mockResolvedValue(json(200))
    session.start({ coldStart: true })
    session.start({ coldStart: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/explore/generate?force=true")
    session.dispose()
  })

  it("settings arrival polls without POSTing and clears the flag on swap", async () => {
    const { session, fetchImpl, storage } = setup()
    storage.getItem.mockReturnValue(String(Date.now() - 1000))
    fetchImpl.mockResolvedValue(json(200, { rails: ALL, generatedAt: "2026-10-05T00:00:00Z" }))
    session.start({ coldStart: false })
    expect(session.getState().isRegenerating).toBe(true)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(["/api/explore/rails"])
    expect(storage.removeItem).toHaveBeenCalledWith(EXPLORE_REGEN_AT_KEY)
    expect(session.getState().isRegenerating).toBe(false)
  })

  it("no flag → nothing happens", () => {
    const { session, fetchImpl } = setup()
    session.start({ coldStart: false })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(session.getState().isRegenerating).toBe(false)
  })
})
