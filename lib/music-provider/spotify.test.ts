import { describe, it, expect, vi, afterEach } from "vitest"
import { getSpotifyTopTracks, searchSpotifyArtists } from "./spotify"

afterEach(() => vi.restoreAllMocks())

describe("Spotify adapter breaker", () => {
  it("a 429 opens the shared breaker: search returns retry-after, then both ops short-circuit without fetching", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "30" } }))

    expect(await searchSpotifyArtists("t", "Nirvana")).toEqual({ rateLimited: true, retryAfterSec: 30 })
    const again = await searchSpotifyArtists("t", "Nirvana")
    expect(again).toMatchObject({ rateLimited: true, skipRetry: true })
    expect(await getSpotifyTopTracks("t", "sp1", 5, "US")).toEqual([])
    expect(fetchSpy).toHaveBeenCalledOnce()
  })
})
