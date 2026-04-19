import { describe, it, expect, vi, beforeEach } from "vitest"
import { SpotifyProvider } from "./spotify-provider"

const provider = new SpotifyProvider()

function lastFmResponse(items: Array<{ name: string; match?: string }>) {
  return {
    similarartists: {
      artist: items,
    },
  }
}

describe("getSimilarArtistNames shape and ranking", () => {
  beforeEach(() => {
    vi.stubEnv("LASTFM_API_KEY", "test-key")
    vi.restoreAllMocks()
  })

  it("returns the full ordered list (no skip-top-N heuristic — tail-bias is done in the engine)", async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      name: `Artist ${i}`,
      match: (1 - i * 0.02).toFixed(2),
    }))
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(lastFmResponse(items)), { status: 200 })
    )

    const result = await provider.getSimilarArtistNames("Seed")
    expect(result).toHaveLength(50)
    expect(result[0].name).toBe("Artist 0")
    expect(result[49].name).toBe("Artist 49")
  })

  it("parses match as a float regardless of string/number encoding", async () => {
    const items = [
      { name: "A", match: "0.95" },
      { name: "B", match: "0.5" },
      { name: "C" },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(lastFmResponse(items)), { status: 200 })
    )

    const result = await provider.getSimilarArtistNames("Seed")
    expect(result[0]).toEqual({ name: "A", match: 0.95 })
    expect(result[1]).toEqual({ name: "B", match: 0.5 })
    expect(result[2]).toEqual({ name: "C", match: 0 })
  })

  it("returns a short list unchanged for niche seeds", async () => {
    const items = [
      { name: "A", match: "0.8" },
      { name: "B", match: "0.5" },
      { name: "C", match: "0.2" },
    ]
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(lastFmResponse(items)), { status: 200 })
    )

    const result = await provider.getSimilarArtistNames("Seed")
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.name)).toEqual(["A", "B", "C"])
  })

  it("returns empty array when API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 6, message: "artist not found" }), { status: 200 })
    )

    const result = await provider.getSimilarArtistNames("Nope")
    expect(result).toEqual([])
  })

  it("returns empty array on non-200 response", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 500 })
    )

    const result = await provider.getSimilarArtistNames("Seed")
    expect(result).toEqual([])
  })
})
