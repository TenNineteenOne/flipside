import { describe, it, expect, vi, beforeEach } from "vitest"
import { fetchTagArtistNames } from "./engine"

/**
 * Regression tests for the Explore left-field perf fix (Explore tab 10s → 3-5s).
 *
 * Root cause was that genre-tree leaf tags are hyphenated slugs ("dutch-black-
 * metal") but Last.fm indexes most multi-word tags space-separated ("dutch
 * black metal" → 267 artists vs 0). The fix tries the tag as-is FIRST (so
 * canonical hyphenated tags like trip-hop keep their better results) and only
 * retries empties with spaces; transient failures throw so the cache layer
 * won't negative-cache them.
 */

function tagResponse(names: string[]) {
  return new Response(
    JSON.stringify({ topartists: { artist: names.map((name) => ({ name })) } }),
    { status: 200 },
  )
}

describe("fetchTagArtistNames hyphen→space retry", () => {
  beforeEach(() => {
    vi.stubEnv("LASTFM_API_KEY", "test-key")
    vi.restoreAllMocks()
  })

  it("returns the as-is result without retrying when the tag has artists", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tagResponse(["Massive Attack", "Portishead"]))

    const out = await fetchTagArtistNames("trip-hop", 30)

    expect(out).toEqual(["Massive Attack", "Portishead"])
    expect(fetchSpy).toHaveBeenCalledTimes(1) // canonical hyphenated tag: no retry
    expect(fetchSpy.mock.calls[0][0]).toContain("tag=trip-hop")
  })

  it("retries a hyphenated tag with spaces when the as-is form is empty", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tagResponse([])) // "dutch-black-metal" → empty
      .mockResolvedValueOnce(tagResponse(["Helleruin", "Sammath"])) // "dutch black metal" → hits

    const out = await fetchTagArtistNames("dutch-black-metal", 30)

    expect(out).toEqual(["Helleruin", "Sammath"])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0][0]).toContain("tag=dutch-black-metal")
    expect(fetchSpy.mock.calls[1][0]).toContain("tag=dutch%20black%20metal")
  })

  it("does not retry a single-word empty tag (no hyphen to normalize)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(tagResponse([]))

    const out = await fetchTagArtistNames("zzznotarealtag", 30)

    expect(out).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("returns the genuinely-empty as-is result if the spaced retry also comes back empty", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tagResponse([]))
      .mockResolvedValueOnce(tagResponse([]))

    const out = await fetchTagArtistNames("made-up-genre", 30)
    expect(out).toEqual([])
  })

  it("throws on a transient failure of the primary spelling (so it isn't cached)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    )

    await expect(fetchTagArtistNames("post-punk", 30)).rejects.toThrow()
  })

  it("does not let a transient retry failure mask a genuinely-empty primary result", async () => {
    // Primary spelling genuinely empty (200, no artists), spaced retry blips (500).
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tagResponse([]))
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))

    const out = await fetchTagArtistNames("flaky-genre", 30)
    expect(out).toEqual([]) // genuine-empty from the primary call, not a throw
  })
})
