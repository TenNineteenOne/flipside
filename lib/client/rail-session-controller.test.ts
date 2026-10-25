import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createRailSession,
  orderRails,
  resolveActiveKey,
  EXPLORE_REGEN_AT_KEY,
  FINAL_GET_RETRY_MS,
  POLL_CEILING_MS,
  POLL_INTERVAL_MS,
  type RailSessionDeps,
} from "./rail-session"
import type { RailKey, RailPayload } from "@/lib/cards/explore-rail-payloads"
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
  const storage = { getItem: vi.fn(() => null as string | null), setItem: vi.fn(), removeItem: vi.fn() }
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

describe("#175 F11 poll lifecycle", () => {
  const STALE = { rails: ALL, generatedAt: "2026-10-01T00:00:00Z" }
  const FRESH = { rails: [rail("adjacent", 5, "new"), ...ALL.slice(1)], generatedAt: "2026-10-02T00:00:00Z" }
  const gets = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => c[0] === "/api/explore/rails").length

  it("(a) dispose during the POST leaves no orphan poller and no toast", async () => {
    const { session, fetchImpl, toast } = setup()
    let resolvePost: (r: Response) => void = () => {}
    fetchImpl.mockReturnValueOnce(new Promise<Response>((r) => { resolvePost = r }))
    fetchImpl.mockResolvedValue(json(200, STALE))
    const p = session.shuffle()
    session.dispose()
    resolvePost(json(200))
    await p
    await vi.advanceTimersByTimeAsync(POLL_CEILING_MS * 2)
    expect(gets(fetchImpl)).toBe(0)
    expect(toast).not.toHaveBeenCalled()
  })

  it("(b) resuming past the ceiling does a final GET and swaps instead of toasting", async () => {
    let t = 0
    const { session, fetchImpl, toast } = setup({ now: () => t })
    fetchImpl.mockResolvedValueOnce(json(200)).mockResolvedValue(json(200, FRESH))
    await session.shuffle()
    t = POLL_CEILING_MS + 60_000 // tab frozen, no ticks ran
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(gets(fetchImpl)).toBe(1)
    expect(session.getState().rails[0].artists[0].id).toBe("new-0")
    expect(session.getState().isRegenerating).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })

  it("(b) final GET still stale → toast and stop", async () => {
    let t = 0
    const { session, fetchImpl, toast } = setup({ now: () => t })
    fetchImpl.mockResolvedValueOnce(json(200)).mockResolvedValue(json(200, STALE))
    await session.shuffle()
    t = POLL_CEILING_MS
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(gets(fetchImpl)).toBe(1)
    expect(toast).toHaveBeenCalledWith("Still building — refresh in a moment", { duration: 4000 })
    expect(session.getState().isRegenerating).toBe(false)
  })

  it("(c) Apply during Shuffle settles both spinners", async () => {
    const { session, fetchImpl } = setup()
    fetchImpl.mockResolvedValueOnce(json(200)).mockResolvedValueOnce(json(200)).mockResolvedValue(json(200, FRESH))
    await session.shuffle()
    await session.toggleAdventurous() // after the shuffle POST, so Apply is still dirty
    await session.applyAdventurous()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(session.getState()).toMatchObject({ isRegenerating: false, isApplyingAdv: false })
  })

  it("(c) Shuffle during Apply settles both spinners", async () => {
    const { session, fetchImpl } = setup()
    await session.toggleAdventurous()
    fetchImpl.mockResolvedValueOnce(json(200)).mockResolvedValueOnce(json(200)).mockResolvedValue(json(200, FRESH))
    await session.applyAdventurous()
    await session.shuffle()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(session.getState()).toMatchObject({ isRegenerating: false, isApplyingAdv: false })
  })

  it("(d) a tick is skipped while a GET is in flight", async () => {
    const { session, fetchImpl } = setup()
    fetchImpl.mockResolvedValueOnce(json(200)).mockReturnValue(new Promise<Response>(() => {}))
    await session.shuffle()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4)
    expect(gets(fetchImpl)).toBe(1)
    session.dispose()
  })

  it("(d) a stale tick resolving late does not kill the newer poll", async () => {
    const { session, fetchImpl } = setup()
    let resolveOld: (r: Response) => void = () => {}
    fetchImpl
      .mockResolvedValueOnce(json(200)) // shuffle POST
      .mockReturnValueOnce(new Promise<Response>((r) => { resolveOld = r })) // old poll's GET hangs
      .mockResolvedValueOnce(json(200)) // apply POST
      .mockResolvedValue(json(200, STALE))
    await session.shuffle()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // old GET in flight
    await session.toggleAdventurous()
    await session.applyAdventurous() // new poll
    resolveOld(json(200, FRESH)) // old tick lands late
    await vi.advanceTimersByTimeAsync(0)
    expect(session.getState().rails).toBe(ALL) // stale generation ignored
    fetchImpl.mockResolvedValue(json(200, FRESH))
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(session.getState().rails[0].artists[0].id).toBe("new-0")
    expect(session.getState()).toMatchObject({ isRegenerating: false, isApplyingAdv: false })
  })

  it("(e) arrival with rails newer than the flag skips polling and clears the flag", () => {
    const { session, fetchImpl, storage } = setup({ initialGeneratedAt: new Date(Date.now()).toISOString() })
    storage.getItem.mockReturnValue(String(Date.now() - 30_000))
    session.start({ coldStart: false })
    expect(session.getState().isRegenerating).toBe(false)
    expect(storage.removeItem).toHaveBeenCalledWith(EXPLORE_REGEN_AT_KEY)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("(f) StrictMode start → dispose → start keeps the arrival poll alive", async () => {
    const { session, fetchImpl, storage } = setup()
    storage.getItem.mockReturnValue(String(Date.now() - 1000))
    fetchImpl.mockResolvedValue(json(200, FRESH))
    session.start({ coldStart: false })
    session.dispose()
    session.start({ coldStart: false })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(gets(fetchImpl)).toBe(1)
    expect(session.getState().isRegenerating).toBe(false)
  })

  it("(f) StrictMode cold start POSTs once and still polls", async () => {
    const { session, fetchImpl } = setup()
    fetchImpl.mockResolvedValueOnce(json(200)).mockResolvedValue(json(200, FRESH))
    session.start({ coldStart: true })
    session.dispose()
    session.start({ coldStart: true })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetchImpl.mock.calls.filter((c) => String(c[0]).includes("generate")).length).toBe(1)
    expect(session.getState().isRegenerating).toBe(false)
  })

  it("(g) toggling on then off is not dirty", async () => {
    const { session } = setup()
    await session.toggleAdventurous()
    session.setAdventurous(true) // useAdventurousMode pushes the flip back
    await session.toggleAdventurous()
    expect(session.getState().isAdvDirty).toBe(false)
  })
})

describe("#175 sweep 2 Y3 — Explore after a rebuild", () => {
  const STALE = { rails: ALL, generatedAt: "2026-10-01T00:00:00Z" }
  const FRESH = { rails: [rail("adjacent", 5, "new"), ...ALL.slice(1)], generatedAt: "2026-10-02T00:00:00Z" }
  const gets = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => c[0] === "/api/explore/rails").length
  function memStorage() {
    const m = new Map<string, string>()
    return {
      getItem: vi.fn((k: string) => m.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => { m.set(k, v) }),
      removeItem: vi.fn((k: string) => { m.delete(k) }),
    }
  }

  it("(a) arrival skips the poll when generatedAt equals the pre-POST flag (build stamped at start)", () => {
    const t0 = Date.parse("2026-10-02T00:00:00Z")
    const { session, fetchImpl, storage } = setup({ initialGeneratedAt: new Date(t0).toISOString(), now: () => t0 + 5_000 })
    storage.getItem.mockReturnValue(String(t0))
    session.start({ coldStart: false })
    expect(session.getState().isRegenerating).toBe(false)
    expect(storage.removeItem).toHaveBeenCalledWith(EXPLORE_REGEN_AT_KEY)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("(b) cold start: a 429 (rebuild already running) polls instead of toasting", async () => {
    const { session, fetchImpl, toast } = setup({ initialRails: [], initialGeneratedAt: null })
    fetchImpl.mockResolvedValueOnce(json(429, { error: "Explore is already refreshing — please wait a moment" }))
      .mockResolvedValue(json(200, FRESH))
    session.start({ coldStart: true })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(toast.error).not.toHaveBeenCalled()
    expect(session.getState().rails[0].artists[0].id).toBe("new-0")
    expect(session.getState().isRegenerating).toBe(false)
  })

  it("(b) shuffle 429 polls too", async () => {
    const { session, fetchImpl, toast } = setup()
    fetchImpl.mockResolvedValueOnce(json(429)).mockResolvedValue(json(200, FRESH))
    await session.shuffle()
    expect(session.getState().isRegenerating).toBe(true)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(toast.error).not.toHaveBeenCalled()
    expect(session.getState().isRegenerating).toBe(false)
  })

  it("(c) leaving mid-shuffle: the next session finds the flag and polls; fresh clears it", async () => {
    const storage = memStorage()
    const a = setup({ storage })
    a.fetchImpl.mockResolvedValueOnce(json(200))
    await a.session.shuffle()
    a.session.dispose()
    expect(storage.getItem(EXPLORE_REGEN_AT_KEY)).not.toBeNull()

    const b = setup({ storage }) // server render still has the old rails
    b.fetchImpl.mockResolvedValueOnce(json(200, STALE)).mockResolvedValue(json(200, FRESH))
    b.session.start({ coldStart: false })
    expect(b.session.getState().isRegenerating).toBe(true)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
    expect(b.fetchImpl).not.toHaveBeenCalledWith("/api/explore/generate?force=true", expect.anything())
    expect(b.session.getState().rails[0].artists[0].id).toBe("new-0")
    expect(storage.getItem(EXPLORE_REGEN_AT_KEY)).toBeNull()
  })

  it("(c) a failed regen POST removes the flag it wrote", async () => {
    const storage = memStorage()
    const { session, fetchImpl } = setup({ storage })
    fetchImpl.mockResolvedValueOnce(json(500))
    await session.shuffle()
    expect(storage.getItem(EXPLORE_REGEN_AT_KEY)).toBeNull()
  })

  it("(d) Toggle → Shuffle clears the dirty flag (rails rebuilt with the new setting)", async () => {
    const { session, fetchImpl } = setup()
    await session.toggleAdventurous()
    session.setAdventurous(true)
    expect(session.getState().isAdvDirty).toBe(true)
    fetchImpl.mockResolvedValueOnce(json(200)).mockResolvedValue(json(200, FRESH))
    await session.shuffle()
    expect(session.getState().isAdvDirty).toBe(false)
    session.dispose()
  })

  it("(e) a thrown final GET is retried once and swaps instead of toasting", async () => {
    let t = 0
    const { session, fetchImpl, toast } = setup({ now: () => t })
    fetchImpl.mockResolvedValueOnce(json(200)).mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(json(200, FRESH))
    await session.shuffle()
    t = POLL_CEILING_MS + 60_000
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(FINAL_GET_RETRY_MS)
    expect(gets(fetchImpl)).toBe(2)
    expect(session.getState().rails[0].artists[0].id).toBe("new-0")
    expect(toast).not.toHaveBeenCalled()
  })
})
