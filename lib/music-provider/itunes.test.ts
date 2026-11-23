import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { searchTracksByArtist } from "./itunes"

function mockITunes(results: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ resultCount: results.length, results }), {
        status: 200,
      })
    )
  )
}

function mockFetchFail(status = 500) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status }))
  )
}

describe("searchTracksByArtist", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("returns tracks with source='itunes' and spotifyTrackId=null", async () => {
    mockITunes([
      {
        trackId: 1,
        trackName: "Dopamine",
        artistName: "Franc Moody",
        collectionName: "Dream in Colour",
        artworkUrl100: "https://is1.example/100x100bb.jpg",
        previewUrl: "https://p.example/1.mp3",
        trackTimeMillis: 200000,
      },
    ])
    const out = await searchTracksByArtist("Franc Moody")
    expect(out).not.toBeNull()
    expect(out!).toHaveLength(1)
    expect(out![0].source).toBe("itunes")
    expect(out![0].spotifyTrackId).toBeNull()
    expect(out![0].id).toBe("1")
    expect(out![0].name).toBe("Dopamine")
    expect(out![0].albumImageUrl).toBe("https://is1.example/600x600bb.jpg")
  })

  it("filters out tracks whose artistName doesn't match (case-insensitive)", async () => {
    mockITunes([
      { trackId: 1, trackName: "A", artistName: "Wrong Artist", collectionName: "X", artworkUrl100: null, previewUrl: null, trackTimeMillis: 1 },
      { trackId: 2, trackName: "B", artistName: "FRANC MOODY", collectionName: "X", artworkUrl100: null, previewUrl: null, trackTimeMillis: 1 },
    ])
    const out = await searchTracksByArtist("Franc Moody")
    expect(out).toHaveLength(1)
    expect(out![0].id).toBe("2")
  })

  it("de-dupes by track name", async () => {
    mockITunes([
      { trackId: 1, trackName: "Song", artistName: "A", collectionName: "Album", artworkUrl100: null, previewUrl: null, trackTimeMillis: 1 },
      { trackId: 2, trackName: "Song", artistName: "A", collectionName: "Single", artworkUrl100: null, previewUrl: null, trackTimeMillis: 1 },
      { trackId: 3, trackName: "Other", artistName: "A", collectionName: "Album", artworkUrl100: null, previewUrl: null, trackTimeMillis: 1 },
    ])
    const out = await searchTracksByArtist("A")
    expect(out!.map((t) => t.id)).toEqual(["1", "3"])
  })

  it("caps at `limit`", async () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      trackId: i,
      trackName: `Song ${i}`,
      artistName: "A",
      collectionName: "Album",
      artworkUrl100: null,
      previewUrl: null,
      trackTimeMillis: 1,
    }))
    mockITunes(results)
    const out = await searchTracksByArtist("A", "US", 3)
    expect(out).toHaveLength(3)
  })

  it("returns null on HTTP failure", async () => {
    mockFetchFail(500)
    const out = await searchTracksByArtist("A")
    expect(out).toBeNull()
  })

  const row = (artistName: string) => ({
    trackId: 7, trackName: "Song", artistName, collectionName: "X", artworkUrl100: null, previewUrl: "https://p.example/7.mp3", trackTimeMillis: 1,
  })
  function mockSequence(...pages: unknown[][]) {
    const fetchMock = vi.fn(async (url: string) => {
      void url
      const results = pages.shift() ?? []
      return new Response(JSON.stringify({ resultCount: results.length, results }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("retries by artistTerm when the first page has no track by the artist", async () => {
    const fetchMock = mockSequence([row("Flo Rida")], [row("Low")])
    const out = await searchTracksByArtist("Low")
    expect(out!.map((t) => t.id)).toEqual(["7"])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain("&limit=200&attribute=artistTerm")
  })

  it("returns a definitive [] when the artist retry also has no match", async () => {
    const fetchMock = mockSequence([row("Flo Rida")], [row("Lowell")])
    expect(await searchTracksByArtist("Low")).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("returns [] without retrying when iTunes has zero results", async () => {
    const fetchMock = mockSequence([])
    expect(await searchTracksByArtist("Zzyzx Qq")).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
