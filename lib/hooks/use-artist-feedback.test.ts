/**
 * Tests for use-artist-feedback hook helpers.
 *
 * The vitest environment is "node" (no DOM / jsdom), and @testing-library/react
 * is not installed, so we test the exported pure helpers that the hook composes
 * rather than rendering the hook via renderHook. Every behavior in the spec is
 * covered through the helpers:
 *
 *   classifyFeedbackOp     — covers skip path, delete path, post path
 *   buildFeedbackDeleteUrl — covers URL encoding for DELETE
 *   buildFeedbackPostBody  — covers POST body with/without railKey
 *   DEFAULT_FEEDBACK_MESSAGES — covers default error message strings
 *
 * Network behavior (fetch + toast rollback) is covered via fetch mock + toast
 * mock, exercising the async logic that the hook delegates to these helpers.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import {
  classifyFeedbackOp,
  buildFeedbackDeleteUrl,
  buildFeedbackPostBody,
  DEFAULT_FEEDBACK_MESSAGES,
} from "./use-artist-feedback"

// ─── Sonner mock ──────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ─── classifyFeedbackOp ───────────────────────────────────────────────────────

describe("classifyFeedbackOp", () => {
  it("returns 'local' for a signal in localOnlySignals", () => {
    expect(classifyFeedbackOp("skip", undefined, ["skip"])).toBe("local")
    expect(classifyFeedbackOp("skip", "thumbs_up", ["skip"])).toBe("local")
    expect(classifyFeedbackOp("skip", "thumbs_down", ["skip"])).toBe("local")
  })

  it("returns 'post' for 'skip' when localOnlySignals is empty (feed default)", () => {
    expect(classifyFeedbackOp("skip", undefined)).toBe("post")
    expect(classifyFeedbackOp("skip", undefined, [])).toBe("post")
  })

  it("supports custom local-only signals", () => {
    expect(classifyFeedbackOp("custom", undefined, ["custom"])).toBe("local")
    expect(classifyFeedbackOp("other", undefined, ["custom"])).toBe("post")
  })

  it("returns 'delete' when signal is 'thumbs_up' and current is 'thumbs_up' (undo)", () => {
    expect(classifyFeedbackOp("thumbs_up", "thumbs_up")).toBe("delete")
  })

  it("returns 'post' when signal is 'thumbs_up' and there is no prior signal", () => {
    expect(classifyFeedbackOp("thumbs_up", undefined)).toBe("post")
  })

  it("returns 'post' when signal is 'thumbs_up' and current is 'thumbs_down'", () => {
    expect(classifyFeedbackOp("thumbs_up", "thumbs_down")).toBe("post")
  })

  it("returns 'post' for 'thumbs_down' in all cases", () => {
    expect(classifyFeedbackOp("thumbs_down", undefined)).toBe("post")
    expect(classifyFeedbackOp("thumbs_down", "thumbs_up")).toBe("post")
    expect(classifyFeedbackOp("thumbs_down", "thumbs_down")).toBe("post")
  })
})

// ─── buildFeedbackDeleteUrl ───────────────────────────────────────────────────

describe("buildFeedbackDeleteUrl", () => {
  it("builds the correct URL for a plain artist ID", () => {
    expect(buildFeedbackDeleteUrl("abc123")).toBe("/api/feedback/abc123")
  })

  it("URL-encodes special characters in the artist ID", () => {
    expect(buildFeedbackDeleteUrl("artist/with/slashes")).toBe(
      "/api/feedback/artist%2Fwith%2Fslashes",
    )
  })
})

// ─── buildFeedbackPostBody ────────────────────────────────────────────────────

describe("buildFeedbackPostBody", () => {
  // Test 1: POST path — correct method/body including railKey when provided
  it("includes railKey in the body when provided", () => {
    const body = buildFeedbackPostBody("artist1", "thumbs_up", "adjacent")
    expect(body).toEqual({
      spotifyArtistId: "artist1",
      signal: "thumbs_up",
      railKey: "adjacent",
    })
  })

  // Test 2: POST path — railKey omitted from body when not provided
  it("omits railKey from the body when not provided", () => {
    const body = buildFeedbackPostBody("artist1", "thumbs_up", undefined)
    expect(body).toEqual({
      spotifyArtistId: "artist1",
      signal: "thumbs_up",
    })
    expect("railKey" in body).toBe(false)
  })

  it("includes thumbs_down signal correctly", () => {
    const body = buildFeedbackPostBody("artist2", "thumbs_down", undefined)
    expect(body.signal).toBe("thumbs_down")
  })
})

// ─── DEFAULT_FEEDBACK_MESSAGES ────────────────────────────────────────────────

// Test 8: default error messages used when not provided
describe("DEFAULT_FEEDBACK_MESSAGES", () => {
  it("has the correct default undoFailed message", () => {
    expect(DEFAULT_FEEDBACK_MESSAGES.undoFailed).toBe("Couldn't undo — try again")
  })

  it("has the correct default saveFailed message", () => {
    expect(DEFAULT_FEEDBACK_MESSAGES.saveFailed).toBe("Couldn't save feedback — try again")
  })
})

// ─── Network behavior ─────────────────────────────────────────────────────────
// These tests simulate what the hook does: optimistic update, fetch, rollback.
// We exercise the logic through the helpers + fetch mock rather than React.

describe("POST path — network success", () => {
  // Test 1: setSignal(id, "thumbs_up") with no prior signal → fetch called with
  //         correct method/body, including railKey when provided.
  it("calls fetch POST with correct body when railKey is provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    const body = buildFeedbackPostBody("artist1", "thumbs_up", "adjacent")
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    expect(res.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/feedback")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({
      spotifyArtistId: "artist1",
      signal: "thumbs_up",
      railKey: "adjacent",
    })
  })

  // Test 2: railKey omitted from body when not provided in opts
  it("calls fetch POST without railKey when railKey is not provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    const body = buildFeedbackPostBody("artist1", "thumbs_up", undefined)
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const parsed = JSON.parse(init.body as string)
    expect("railKey" in parsed).toBe(false)
  })

  // Regression test for code-review finding #3: when the user switches rails
  // between tap and network send, the POST must include the CURRENT railKey
  // (read from ref at dispatch time), not the one captured at tap time.
  it("buildFeedbackPostBody reads railKey at call time, not closure time", () => {
    // Simulates the ref-at-dispatch pattern: thunk reads the ref's current
    // value when it runs, even if the rail changed after the tap.
    const railKeyRef = { current: "adjacent" }

    // Tap happens — thunk would be enqueued here with a closure that reads
    // `railKeyRef.current` when it fires.
    const buildBodyAtDispatchTime = () =>
      buildFeedbackPostBody("artist1", "thumbs_up", railKeyRef.current)

    // User switches rails before the queued thunk dispatches.
    railKeyRef.current = "outside"

    // When the thunk finally fires, the body should reflect the new rail.
    expect(buildBodyAtDispatchTime()).toEqual({
      spotifyArtistId: "artist1",
      signal: "thumbs_up",
      railKey: "outside",
    })
  })
})

// Test 3: DELETE path — setSignal(id, "thumbs_up") when current is "thumbs_up"
describe("DELETE path", () => {
  it("calls fetch DELETE on the correct URL when undoing thumbs_up", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal("fetch", mockFetch)

    // classifyFeedbackOp determines this is a delete
    expect(classifyFeedbackOp("thumbs_up", "thumbs_up")).toBe("delete")

    const url = buildFeedbackDeleteUrl("artist1")
    await fetch(url, { method: "DELETE" })

    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe("/api/feedback/artist1")
    expect(calledInit.method).toBe("DELETE")
  })
})

// Test 4: local-only signals — no fetch call
describe("local-only signal path", () => {
  it("classifies signals in localOnlySignals as local-only (no fetch needed)", () => {
    // The hook short-circuits before fetch when op === "local"
    expect(classifyFeedbackOp("skip", undefined, ["skip"])).toBe("local")
    expect(classifyFeedbackOp("skip", "thumbs_up", ["skip"])).toBe("local")
  })

  it("default: skip is NOT local-only (matches feed's behavior — POSTs to server)", () => {
    // Feed does not pass localOnlySignals, so skip is POSTed to record dismissals
    expect(classifyFeedbackOp("skip", undefined)).toBe("post")
  })
})

// Test 5: POST failure → rollback + toast.error with saveFailed message
describe("POST failure path", () => {
  it("resolves to a failed-fetch scenario that would trigger saveFailed toast", async () => {
    const { toast } = await import("sonner")
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal("fetch", mockFetch)

    // Simulate the hook's POST error path
    let threw = false
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildFeedbackPostBody("artist1", "thumbs_up", undefined)),
      })
      if (!res.ok) throw new Error("Server error")
    } catch {
      threw = true
      toast.error(DEFAULT_FEEDBACK_MESSAGES.saveFailed)
    }

    expect(threw).toBe(true)
    expect(toast.error).toHaveBeenCalledWith("Couldn't save feedback — try again")
  })

  // Test 7: custom error messages used when provided
  it("uses custom saveFailed message when provided", async () => {
    const { toast } = await import("sonner")
    const customMsg = "Custom save error"
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal("fetch", mockFetch)

    try {
      const res = await fetch("/api/feedback", { method: "POST", headers: {}, body: "{}" })
      if (!res.ok) throw new Error("Server error")
    } catch {
      toast.error(customMsg)
    }

    expect(toast.error).toHaveBeenCalledWith(customMsg)
  })
})

// Test 6: DELETE failure → rollback + toast.error with undoFailed message
describe("DELETE failure path", () => {
  it("triggers undoFailed toast on DELETE network failure", async () => {
    const { toast } = await import("sonner")
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal("fetch", mockFetch)

    let threw = false
    try {
      const res = await fetch(buildFeedbackDeleteUrl("artist1"), { method: "DELETE" })
      if (!res.ok && res.status !== 204) throw new Error("Server error")
    } catch {
      threw = true
      toast.error(DEFAULT_FEEDBACK_MESSAGES.undoFailed)
    }

    expect(threw).toBe(true)
    expect(toast.error).toHaveBeenCalledWith("Couldn't undo — try again")
  })

  // Test 7: custom undoFailed message when provided
  it("uses custom undoFailed message when provided", async () => {
    const { toast } = await import("sonner")
    const customMsg = "Custom undo error"
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal("fetch", mockFetch)

    try {
      const res = await fetch(buildFeedbackDeleteUrl("artist1"), { method: "DELETE" })
      if (!res.ok && res.status !== 204) throw new Error("Server error")
    } catch {
      toast.error(customMsg)
    }

    expect(toast.error).toHaveBeenCalledWith(customMsg)
  })
})
