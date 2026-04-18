import { describe, it, expect, vi, beforeEach } from "vitest"
import { SpotifyProvider } from "./spotify-provider"

// Stub fetch globally for Last.fm calls
const provider = new SpotifyProvider()

function lastFmResponse(names: string[]) {
  return {
    similarartists: {
      artist: names.map((name) => ({ name })),
    },
  }
}

describe("getSimilarArtistNames candidate slice", () => {
  beforeEach(() => {
    vi.stubEnv("LASTFM_API_KEY", "test-key")
    vi.restoreAllMocks()
  })

  it("returns 15 items from a 50-item list, skipping top 3", async () => {
    const names = Array.from({ length: 50 }, (_, i) => `Artist ${i}`)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(lastFmResponse(names)), { status: 200 })
    )

    const result = await provider.getSimilarArtistNames("Seed")
    expect(result).toHaveLength(15)
    expect(result[0]).toBe("Artist 3")
    expect(result[14]).toBe("Artist 17")
  })

  it("returns all items when fewer than 4 (niche artist fallback)", async () => {
    const names = ["A", "B", "C"]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(lastFmResponse(names)), { status: 200 })
    )

    const result = await provider.getSimilarArtistNames("Seed")
    expect(result).toEqual(["A", "B", "C"])
  })

  it("returns 1 candidate when exactly 4 items", async () => {
    const names = ["A", "B", "C", "D"]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(lastFmResponse(names)), { status: 200 })
    )

    const result = await provider.getSimilarArtistNames("Seed")
    expect(result).toHaveLength(1)
    expect(result[0]).toBe("D")
  })

  it("returns available items when list has 10 items", async () => {
    const names = Array.from({ length: 10 }, (_, i) => `Artist ${i}`)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(lastFmResponse(names)), { status: 200 })
    )

    const result = await provider.getSimilarArtistNames("Seed")
    expect(result).toHaveLength(7) // items at indices 3-9
    expect(result[0]).toBe("Artist 3")
    expect(result[6]).toBe("Artist 9")
  })
})
