import { describe, it, expect } from "vitest"
import {
  fetchArtistEnrichment,
  mergeEnrichment,
  scaleListeners,
  filterGenreTags,
} from "./enrich-artist"
import type { Artist } from "@/lib/music-provider/types"

function makeFetch(response: unknown, ok = true): typeof fetch {
  return (async () => ({
    ok,
    json: async () => response,
  })) as unknown as typeof fetch
}

function artist(overrides: Partial<Artist> = {}): Artist {
  return {
    id: "sp1",
    name: "Test",
    genres: [],
    imageUrl: null,
    popularity: 0,
    ...overrides,
  }
}

describe("scaleListeners", () => {
  it("returns 0 for zero or negative listener counts", () => {
    expect(scaleListeners(0)).toBe(0)
    expect(scaleListeners(-100)).toBe(0)
  })

  it("calibrates 10K ≈ 30, 1M ≈ 60, 100M ≈ 90", () => {
    expect(scaleListeners(10_000)).toBeGreaterThanOrEqual(28)
    expect(scaleListeners(10_000)).toBeLessThanOrEqual(32)
    expect(scaleListeners(1_000_000)).toBeGreaterThanOrEqual(58)
    expect(scaleListeners(1_000_000)).toBeLessThanOrEqual(62)
    expect(scaleListeners(100_000_000)).toBeGreaterThanOrEqual(88)
    expect(scaleListeners(100_000_000)).toBeLessThanOrEqual(92)
  })

  it("clamps to 0-100 range", () => {
    expect(scaleListeners(1e15)).toBeLessThanOrEqual(100)
    expect(scaleListeners(1)).toBeGreaterThanOrEqual(0)
  })
})

describe("filterGenreTags", () => {
  it("drops non-genre noise tags", () => {
    expect(filterGenreTags(["seen live", "rock", "favorite"])).toEqual(["rock"])
  })

  it("drops era-style tags like 90s, 2000s, pre-1970s", () => {
    expect(filterGenreTags(["90s", "2000s", "pre-1970s", "indie rock"])).toEqual([
      "indie rock",
    ])
  })

  it("lowercases, trims, and de-spaces consistently", () => {
    expect(filterGenreTags(["  Rock  ", "Indie Pop"])).toEqual(["rock", "indie pop"])
  })

  it("caps at 5 tags", () => {
    const tags = ["a", "b", "c", "d", "e", "f", "g"]
    expect(filterGenreTags(tags)).toHaveLength(5)
  })

  it("drops empty strings", () => {
    expect(filterGenreTags(["", "  ", "rock"])).toEqual(["rock"])
  })
})

describe("mergeEnrichment", () => {
  it("leaves artist untouched when enrichment is null", () => {
    const a = artist({ genres: [], popularity: 0 })
    expect(mergeEnrichment(a, null)).toBe(a)
  })

  it("fills empty genres and popularity from enrichment", () => {
    const a = artist({ genres: [], popularity: 0 })
    const merged = mergeEnrichment(a, { genres: ["jazz"], popularity: 42 })
    expect(merged.genres).toEqual(["jazz"])
    expect(merged.popularity).toBe(42)
  })

  it("preserves existing Spotify genres if already populated", () => {
    const a = artist({ genres: ["existing"], popularity: 0 })
    const merged = mergeEnrichment(a, { genres: ["new"], popularity: 50 })
    expect(merged.genres).toEqual(["existing"])
    expect(merged.popularity).toBe(50)
  })

  it("preserves existing Spotify popularity if already > 0", () => {
    const a = artist({ genres: [], popularity: 75 })
    const merged = mergeEnrichment(a, { genres: ["x"], popularity: 10 })
    expect(merged.popularity).toBe(75)
    expect(merged.genres).toEqual(["x"])
  })
})

describe("fetchArtistEnrichment", () => {
  it("returns null when API key is missing", async () => {
    const result = await fetchArtistEnrichment("Khruangbin", "", makeFetch({}))
    expect(result).toBeNull()
  })

  it("returns null when HTTP response is non-OK", async () => {
    const result = await fetchArtistEnrichment("X", "key", makeFetch({}, false))
    expect(result).toBeNull()
  })

  it("returns null on Last.fm error payload", async () => {
    const result = await fetchArtistEnrichment(
      "X",
      "key",
      makeFetch({ error: 6, message: "not found" })
    )
    expect(result).toBeNull()
  })

  it("parses listeners and tags into enrichment", async () => {
    const result = await fetchArtistEnrichment(
      "Khruangbin",
      "key",
      makeFetch({
        artist: {
          stats: { listeners: "500000" },
          tags: {
            tag: [
              { name: "Psychedelic Rock" },
              { name: "Indie Rock" },
              { name: "seen live" },
            ],
          },
        },
      })
    )
    expect(result).not.toBeNull()
    expect(result!.genres).toEqual(["psychedelic rock", "indie rock"])
    expect(result!.popularity).toBeGreaterThan(40)
    expect(result!.popularity).toBeLessThan(70)
  })

  it("returns null on fetch throw (timeout, network)", async () => {
    const brokenFetch = (async () => {
      throw new Error("timeout")
    }) as unknown as typeof fetch
    const result = await fetchArtistEnrichment("X", "key", brokenFetch)
    expect(result).toBeNull()
  })

  it("handles missing stats/tags gracefully", async () => {
    const result = await fetchArtistEnrichment(
      "X",
      "key",
      makeFetch({ artist: {} })
    )
    expect(result).not.toBeNull()
    expect(result!.genres).toEqual([])
    expect(result!.popularity).toBe(0)
  })
})
