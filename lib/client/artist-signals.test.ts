import { describe, it, expect, vi } from "vitest"
import { createArtistFeedback, createArtistSaves } from "./artist-signals"

/** A fetch whose calls resolve only when the test says so, in any order. */
function controlledFetch() {
  const calls: Array<{ url: string; init?: RequestInit; resolve: (ok: boolean) => void }> = []
  const fetchImpl = vi.fn((url: string, init?: RequestInit) =>
    new Promise<Response>((res) => {
      calls.push({ url, init, resolve: (ok) => res({ ok, status: ok ? 200 : 500 } as Response) })
    }),
  ) as unknown as typeof fetch
  return { fetchImpl, calls }
}
const flush = () => new Promise((r) => setTimeout(r, 0))
const body = (init?: RequestInit) => JSON.parse(String(init?.body))

function feedback(extra: Partial<Parameters<typeof createArtistFeedback>[0]> = {}) {
  const f = controlledFetch()
  const toast = { error: vi.fn() }
  const c = createArtistFeedback({ fetchImpl: f.fetchImpl, toast, ...extra })
  return { ...f, toast, c, sig: (id = "a") => c.store.get(id) }
}
/** Start artist "a" at a confirmed verdict, with no network call. */
const seed = (c: ReturnType<typeof feedback>["c"], v: string) => c.store.confirmedOp("a", v, async () => {})

describe("feedback: optimistic before queue", () => {
  it("both taps show immediately; calls go out one at a time in tap order", async () => {
    const { c, calls, sig } = feedback()
    const t1 = c.setSignal("a", "thumbs_up")
    expect(sig()).toBe("thumbs_up")
    const t2 = c.setSignal("a", "thumbs_up") // toggle off — classified against what the user saw
    expect(sig()).toBeUndefined()
    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0].init?.method).toBe("POST")
    calls[0].resolve(true)
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe("/api/feedback/a")
    expect(calls[1].init?.method).toBe("DELETE")
    calls[1].resolve(true)
    expect(await Promise.all([t1, t2])).toEqual([true, true])
    expect(sig()).toBeUndefined()
  })

  it("tap/tap, first fails: visible stays on the later intent, which then succeeds", async () => {
    const { c, calls, sig, toast } = feedback()
    c.setSignal("a", "thumbs_up")
    const t2 = c.setSignal("a", "thumbs_down")
    await flush()
    calls[0].resolve(false)
    await flush()
    expect(sig()).toBe("thumbs_down") // not rolled back under the pending tap
    expect(toast.error).toHaveBeenCalledWith("Couldn't save feedback. Try again.")
    calls[1].resolve(true)
    await t2
    expect(sig()).toBe("thumbs_down")
  })

  it("tap/tap, second fails: falls back to the first (confirmed) value", async () => {
    const { c, calls, sig } = feedback()
    c.setSignal("a", "thumbs_up")
    const t2 = c.setSignal("a", "thumbs_down")
    await flush()
    calls[0].resolve(true)
    await flush()
    calls[1].resolve(false)
    await t2
    expect(sig()).toBe("thumbs_up")
  })

  it("tap/tap, both fail: back to the original value (no phantom like)", async () => {
    const { c, calls, sig, toast } = feedback()
    c.setSignal("a", "thumbs_up")
    const t2 = c.setSignal("a", "thumbs_up") // unlike
    await flush()
    calls[0].resolve(false)
    await flush()
    calls[1].resolve(false)
    await t2
    expect(sig()).toBeUndefined()
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo. Try again.")
  })



  it("other artists are independent", async () => {
    const { c, calls } = feedback()
    c.setSignal("a", "thumbs_up")
    c.setSignal("b", "thumbs_up")
    await flush()
    expect(calls).toHaveLength(2)
  })
})

describe("feedback: confirmed ops (History undo/unblock)", () => {
  it("removeSignal clears only after the server confirms; failure toasts and keeps it", async () => {
    const { c, calls, sig, toast } = feedback()
    c.setSignal("a", "thumbs_down")
    await flush()
    calls[0].resolve(true)
    const undo = c.removeSignal("a")
    await flush()
    expect(sig()).toBe("thumbs_down") // still shown while undoing
    calls[1].resolve(false)
    expect(await undo).toBe(false)
    expect(sig()).toBe("thumbs_down")
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo. Try again.")

    const undo2 = c.removeSignal("a")
    await flush()
    calls[2].resolve(true)
    expect(await undo2).toBe(true)
    expect(sig()).toBeUndefined()
  })

  it("dismiss hits /api/dismiss and resolves success", async () => {
    const { c, calls } = feedback()
    const p = c.dismiss("x y")
    await flush()
    expect(calls[0].url).toBe("/api/dismiss/x y")
    expect(calls[0].init?.method).toBe("DELETE")
    calls[0].resolve(true)
    expect(await p).toBe(true)
  })
})

describe("feedback: restore (feed undo)", () => {
  /** Resolve every call (in order, as each is sent) and return them as "METHOD url [signal]". */
  async function drain(calls: ReturnType<typeof controlledFetch>["calls"], ok = true) {
    for (let i = 0; i < 10; i++) {
      await flush()
      calls.forEach((c) => c.resolve(ok))
    }
    return calls.map((c) => `${c.init?.method} ${c.url}${c.init?.body ? ` ${body(c.init).signal}` : ""}`)
  }

  it.each([
    ["thumbs_up", undefined, ["DELETE /api/feedback/a"]],
    ["thumbs_down", undefined, ["DELETE /api/feedback/a"]],
    ["skip", undefined, ["DELETE /api/dismiss/a"]],
    ["thumbs_down", "thumbs_up", ["POST /api/feedback thumbs_up"]],
    ["thumbs_up", "thumbs_down", ["POST /api/feedback thumbs_down"]],
    ["skip", "thumbs_up", ["DELETE /api/dismiss/a", "POST /api/feedback thumbs_up"]],
    ["skip", "thumbs_down", ["DELETE /api/dismiss/a", "POST /api/feedback thumbs_down"]],
    ["thumbs_up", "skip", ["DELETE /api/feedback/a"]],
    [undefined, "thumbs_up", ["POST /api/feedback thumbs_up"]],
    [undefined, "skip", ["POST /api/feedback skip"]],
    ["thumbs_down", "thumbs_down", []],
    [undefined, undefined, []],
  ] as const)("%s → %s sends %j and shows the previous verdict at once", async (current, previous, expected) => {
    const { c, calls, sig } = feedback()
    if (current) await seed(c, current)
    const p = c.restore("a", previous)
    expect(sig()).toBe(previous)
    expect(await drain(calls)).toEqual(expected)
    expect(await p).toBe(true)
    expect(sig()).toBe(previous)
  })

  it("X, Z, L with slow responses: ends liked; POST, DELETE, POST in order", async () => {
    const { c, calls, sig } = feedback()
    c.setSignal("a", "thumbs_down")
    c.restore("a", undefined)
    expect(sig()).toBeUndefined()
    const last = c.setSignal("a", "thumbs_up")
    expect(sig()).toBe("thumbs_up")
    expect(await drain(calls)).toEqual(["POST /api/feedback thumbs_down", "DELETE /api/feedback/a", "POST /api/feedback thumbs_up"])
    await last
    expect(sig()).toBe("thumbs_up")
  })

  it("a failed undo rolls back to the confirmed verdict and toasts", async () => {
    const { c, calls, sig, toast } = feedback()
    await seed(c, "thumbs_down")
    const p = c.restore("a", undefined)
    expect(sig()).toBeUndefined()
    await drain(calls, false)
    expect(await p).toBe(false)
    expect(sig()).toBe("thumbs_down")
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo. Try again.")
  })

  it("skip → thumbs: once the DELETE succeeded, a failed POST still counts as undone (no rollback, no toast)", async () => {
    const { c, calls, sig, toast } = feedback()
    await seed(c, "skip")
    const p = c.restore("a", "thumbs_up")
    await flush()
    calls[0].resolve(true) // DELETE /api/dismiss/a
    await flush()
    calls[1].resolve(false) // POST thumbs_up (only re-stamps seen_at)
    expect(await p).toBe(true)
    expect(sig()).toBe("thumbs_up")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("skip → thumbs: a failed DELETE rolls back to skip and toasts", async () => {
    const { c, calls, sig, toast } = feedback()
    await seed(c, "skip")
    const p = c.restore("a", "thumbs_up")
    await flush()
    calls[0].resolve(false)
    expect(await p).toBe(false)
    expect(sig()).toBe("skip")
    expect(calls).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo. Try again.")
  })

  it("undo after a failed (rolled back) decision sends nothing", async () => {
    const { c, calls, sig } = feedback()
    const t = c.setSignal("a", "thumbs_up")
    await flush()
    calls[0].resolve(false)
    await t
    expect(sig()).toBeUndefined()
    expect(await c.restore("a", undefined)).toBe(true)
    await flush()
    expect(calls).toHaveLength(1)
  })
})

describe("saves", () => {
  function saves(initial: string[] = []) {
    const f = controlledFetch()
    const toast = { error: vi.fn() }
    const c = createArtistSaves({ fetchImpl: f.fetchImpl, toast, initialSavedIds: initial })
    return { ...f, toast, c, saved: (id = "a") => c.store.get(id) === true }
  }

  it("save/unsave both fail → back to unsaved, both toasts", async () => {
    const { c, calls, saved, toast } = saves()
    c.toggleSave("a")
    const t2 = c.toggleSave("a")
    expect(saved()).toBe(false)
    await flush()
    expect(calls[0].init?.method).toBe("POST")
    calls[0].resolve(false)
    await flush()
    expect(calls[1].init?.method).toBe("DELETE")
    calls[1].resolve(false)
    await t2
    expect(saved()).toBe(false)
    expect(toast.error.mock.calls.map((x) => x[0])).toEqual(["Couldn't save. Try again.", "Couldn't unsave. Try again."])
  })

  it("unsave of an initially-saved artist rolls back on failure", async () => {
    const { c, calls, saved } = saves(["a"])
    const t = c.toggleSave("a")
    expect(saved()).toBe(false)
    await flush()
    calls[0].resolve(false)
    await t
    expect(saved()).toBe(true)
  })
})
