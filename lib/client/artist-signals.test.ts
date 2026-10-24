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
    expect(toast.error).toHaveBeenCalledWith("Couldn't save feedback — try again")
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
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo — try again")
  })

  it("local-only signals skip the network but still queue behind in-flight calls", async () => {
    const { c, calls, sig } = feedback({ localOnlySignals: ["skip"] })
    c.setSignal("a", "thumbs_up")
    const t2 = c.setSignal("a", "skip")
    expect(sig()).toBe("skip")
    await flush()
    calls[0].resolve(false) // like fails while skip is queued
    await t2
    expect(sig()).toBe("skip")
    expect(calls).toHaveLength(1)
  })

  it("#175 Y3: sends the rail current at tap time, even when the POST is queued", async () => {
    const { c, calls } = feedback({ railKey: "adjacent" })
    c.setSignal("a", "thumbs_up")
    c.setSignal("a", "thumbs_down") // queued behind the like, tapped on adjacent
    c.setRailKey("outside")
    await flush()
    expect(body(calls[0].init).railKey).toBe("adjacent")
    calls[0].resolve(true)
    await flush()
    expect(body(calls[1].init).railKey).toBe("adjacent")
    c.setRailKey(undefined)
    c.setSignal("b", "thumbs_down")
    await flush()
    expect(body(calls[2].init)).toEqual({ artistId: "b", signal: "thumbs_down" })
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
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo — try again")

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

  it("bulk replace drops signals locally and from the rollback baseline", async () => {
    const { c, calls, sig } = feedback()
    c.setSignal("a", "thumbs_up")
    await flush()
    calls[0].resolve(true)
    await flush()
    c.store.replace(() => new Map())
    expect(sig()).toBeUndefined()
    const t = c.setSignal("a", "thumbs_down")
    await flush()
    calls[1].resolve(false)
    await t
    expect(sig()).toBeUndefined() // not resurrected
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
    expect(toast.error.mock.calls.map((x) => x[0])).toEqual(["Couldn't save — try again", "Couldn't unsave — try again"])
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
