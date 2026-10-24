import { describe, it, expect, vi, afterEach } from "vitest"
import { patchSettings, SettingsSaveError } from "./patch-settings"

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

    await expect(patchSettings({ undergroundMode: true })).rejects.toThrow("quota exceeded")
  })

  it("throws generic message when error body is empty", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error("not json")),
    })
    vi.stubGlobal("fetch", mockFetch)

    await expect(patchSettings({ undergroundMode: true })).rejects.toThrow("Failed to save")
  })

  it("rejects with SettingsSaveError carrying the status; network errors pass through", async () => {
    const err = await patchSettings({ adventurous: true }, {
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: "bad" }) }),
    }).catch((e) => e)
    expect(err).toBeInstanceOf(SettingsSaveError)
    expect(err).toMatchObject({ message: "bad", status: 400 })

    const net = await patchSettings({ adventurous: true }, { fetchImpl: vi.fn().mockRejectedValue(new TypeError("offline")) }).catch((e) => e)
    expect(net).not.toBeInstanceOf(SettingsSaveError)
  })

  it("forwards the abort signal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    const aborter = new AbortController()
    await patchSettings({ selectedGenres: ["jazz"] }, { signal: aborter.signal, fetchImpl })
    expect((fetchImpl.mock.calls[0][1] as RequestInit).signal).toBe(aborter.signal)
  })
})
