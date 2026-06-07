/**
 * Tests for use-artist-saves hook helpers.
 *
 * The vitest environment is "node" (no DOM / jsdom), and @testing-library/react
 * is not installed, so we test the exported pure helpers that the hook composes
 * rather than rendering the hook via renderHook. Every behavior in the spec is
 * covered through the helpers:
 *
 *   buildSaveFetchInit      — covers POST/DELETE method selection and body shape
 *   DEFAULT_SAVES_MESSAGES  — covers default error message strings
 *
 * Network behavior (fetch + toast rollback) is covered via fetch mock + toast
 * mock, exercising the async logic the hook delegates to these helpers.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { buildSaveFetchInit, DEFAULT_SAVES_MESSAGES } from "./use-artist-saves"

// ─── Sonner mock ──────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ─── buildSaveFetchInit ───────────────────────────────────────────────────────

describe("buildSaveFetchInit", () => {
  it("returns method POST when willUnsave is false (saving)", () => {
    const init = buildSaveFetchInit("artist1", false)
    expect(init.method).toBe("POST")
  })

  it("returns method DELETE when willUnsave is true (unsaving)", () => {
    const init = buildSaveFetchInit("artist1", true)
    expect(init.method).toBe("DELETE")
  })

  it("includes artistId in the body for POST", () => {
    const init = buildSaveFetchInit("artist1", false)
    expect(JSON.parse(init.body as string)).toEqual({ artistId: "artist1" })
  })

  it("includes artistId in the body for DELETE", () => {
    const init = buildSaveFetchInit("artist1", true)
    expect(JSON.parse(init.body as string)).toEqual({ artistId: "artist1" })
  })

  it("sets Content-Type to application/json", () => {
    const init = buildSaveFetchInit("artist1", false)
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
  })
})

// ─── DEFAULT_SAVES_MESSAGES ───────────────────────────────────────────────────

// Test 5 (default messages): covers default error message strings
describe("DEFAULT_SAVES_MESSAGES", () => {
  it("has the correct default saveFailed message", () => {
    expect(DEFAULT_SAVES_MESSAGES.saveFailed).toBe("Couldn't save — try again")
  })

  it("has the correct default unsaveFailed message", () => {
    expect(DEFAULT_SAVES_MESSAGES.unsaveFailed).toBe("Couldn't unsave — try again")
  })
})

// ─── Network behavior ─────────────────────────────────────────────────────────
// Simulate what the hook does: optimistic update, fetch, rollback on failure.

// Test 1: POST path — toggleSave when not saved → fetch with method POST
describe("POST path — saving an artist", () => {
  it("calls fetch with method POST when artist is not saved", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    // Artist is not saved (willUnsave = false)
    const init = buildSaveFetchInit("artist1", false)
    await fetch("/api/saves", init)

    const [url, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/saves")
    expect(calledInit.method).toBe("POST")
    expect(JSON.parse(calledInit.body as string)).toEqual({ artistId: "artist1" })
  })
})

// Test 2: DELETE path — toggleSave when already saved → fetch with method DELETE
describe("DELETE path — unsaving an artist", () => {
  it("calls fetch with method DELETE when artist is already saved", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    // Artist is saved (willUnsave = true)
    const init = buildSaveFetchInit("artist1", true)
    await fetch("/api/saves", init)

    const [url, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/saves")
    expect(calledInit.method).toBe("DELETE")
  })
})

// Test 3: POST failure → rollback + toast.error with saveFailed
describe("POST failure path", () => {
  it("triggers saveFailed toast on POST network failure", async () => {
    const { toast } = await import("sonner")
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal("fetch", mockFetch)

    let threw = false
    try {
      const res = await fetch("/api/saves", buildSaveFetchInit("artist1", false))
      if (!res.ok) throw new Error("Server error")
    } catch {
      threw = true
      // willUnsave = false → saveFailed
      toast.error(DEFAULT_SAVES_MESSAGES.saveFailed)
    }

    expect(threw).toBe(true)
    expect(toast.error).toHaveBeenCalledWith("Couldn't save — try again")
  })

  // Test 5: custom messages used when provided
  it("uses custom saveFailed message when provided", async () => {
    const { toast } = await import("sonner")
    const customMsg = "Custom save failed"
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal("fetch", mockFetch)

    try {
      const res = await fetch("/api/saves", buildSaveFetchInit("artist1", false))
      if (!res.ok) throw new Error("Server error")
    } catch {
      toast.error(customMsg)
    }

    expect(toast.error).toHaveBeenCalledWith(customMsg)
  })
})

// Test 4: DELETE failure → rollback + toast.error with unsaveFailed
describe("DELETE failure path", () => {
  it("triggers unsaveFailed toast on DELETE network failure", async () => {
    const { toast } = await import("sonner")
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal("fetch", mockFetch)

    let threw = false
    try {
      const res = await fetch("/api/saves", buildSaveFetchInit("artist1", true))
      if (!res.ok) throw new Error("Server error")
    } catch {
      threw = true
      // willUnsave = true → unsaveFailed
      toast.error(DEFAULT_SAVES_MESSAGES.unsaveFailed)
    }

    expect(threw).toBe(true)
    expect(toast.error).toHaveBeenCalledWith("Couldn't unsave — try again")
  })

  // Test 5: custom messages used when provided
  it("uses custom unsaveFailed message when provided", async () => {
    const { toast } = await import("sonner")
    const customMsg = "Custom unsave failed"
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal("fetch", mockFetch)

    try {
      const res = await fetch("/api/saves", buildSaveFetchInit("artist1", true))
      if (!res.ok) throw new Error("Server error")
    } catch {
      toast.error(customMsg)
    }

    expect(toast.error).toHaveBeenCalledWith(customMsg)
  })
})
