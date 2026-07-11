/**
 * Tests for SpotifyProvider's playlist methods (createPlaylist, addTracksToPlaylist).
 * Style follows itunes.test.ts: stub global fetch, no network.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { SpotifyProvider } from "./spotify-provider"

function mockFetchOnce(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SpotifyProvider.createPlaylist", () => {
  it("returns the playlist id on success", async () => {
    mockFetchOnce(201, { id: "playlist123" })
    const provider = new SpotifyProvider()
    const id = await provider.createPlaylist("token", "user1", "My Playlist")
    expect(id).toBe("playlist123")
  })

  it("includes the description in the request body when provided", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: "p1" }), { status: 201 })
    )
    vi.stubGlobal("fetch", fetchMock)
    const provider = new SpotifyProvider()
    await provider.createPlaylist("token", "user1", "My Playlist", "desc")
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init!.body as string)).toEqual({ name: "My Playlist", public: false, description: "desc" })
  })

  it("throws 'scope_missing' on 403", async () => {
    mockFetchOnce(403)
    const provider = new SpotifyProvider()
    await expect(provider.createPlaylist("token", "user1", "My Playlist")).rejects.toThrow("scope_missing")
  })

  it("throws 'rate_limited' on 429", async () => {
    mockFetchOnce(429)
    const provider = new SpotifyProvider()
    await expect(provider.createPlaylist("token", "user1", "My Playlist")).rejects.toThrow("rate_limited")
  })

  it("throws 'auth_expired' on 401", async () => {
    mockFetchOnce(401)
    const provider = new SpotifyProvider()
    await expect(provider.createPlaylist("token", "user1", "My Playlist")).rejects.toThrow("auth_expired")
  })

  it("throws 'http_500' on other failures", async () => {
    mockFetchOnce(500)
    const provider = new SpotifyProvider()
    await expect(provider.createPlaylist("token", "user1", "My Playlist")).rejects.toThrow("http_500")
  })
})

describe("SpotifyProvider.addTracksToPlaylist", () => {
  it("resolves on success", async () => {
    mockFetchOnce(201)
    const provider = new SpotifyProvider()
    await expect(provider.addTracksToPlaylist("token", "playlist1", ["track1"])).resolves.toBeUndefined()
  })

  it("sends spotify:track: URIs built from track IDs", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("", { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)
    const provider = new SpotifyProvider()
    await provider.addTracksToPlaylist("token", "playlist1", ["t1", "t2"])
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init!.body as string)).toEqual({ uris: ["spotify:track:t1", "spotify:track:t2"] })
  })

  it("throws 'scope_missing' on 403", async () => {
    mockFetchOnce(403)
    const provider = new SpotifyProvider()
    await expect(provider.addTracksToPlaylist("token", "playlist1", ["track1"])).rejects.toThrow("scope_missing")
  })

  it("throws 'rate_limited' on 429", async () => {
    mockFetchOnce(429)
    const provider = new SpotifyProvider()
    await expect(provider.addTracksToPlaylist("token", "playlist1", ["track1"])).rejects.toThrow("rate_limited")
  })

  it("throws 'auth_expired' on 401", async () => {
    mockFetchOnce(401)
    const provider = new SpotifyProvider()
    await expect(provider.addTracksToPlaylist("token", "playlist1", ["track1"])).rejects.toThrow("auth_expired")
  })
})
