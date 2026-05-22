import { describe, it, expect, vi, afterEach } from "vitest"
import { patchSettings } from "./patch-settings"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("patchSettings", () => {
  it("calls PATCH /api/settings with JSON body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    await patchSettings({ playThreshold: 10 })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/settings")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({ playThreshold: 10 })
  })

  it("throws with server error message when response is not ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "quota exceeded" }),
    })
    vi.stubGlobal("fetch", mockFetch)

    await expect(patchSettings({ foo: "bar" })).rejects.toThrow("quota exceeded")
  })

  it("throws generic message when error body is empty", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error("not json")),
    })
    vi.stubGlobal("fetch", mockFetch)

    await expect(patchSettings({ foo: "bar" })).rejects.toThrow("Failed to save")
  })
})
