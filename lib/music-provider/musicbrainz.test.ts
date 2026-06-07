import { describe, it, expect } from "vitest"
import {
  parseSpotifyArtistId,
  parseAppleArtistId,
  parseDeezerArtistId,
  extractExternalIds,
  createMbLimiter,
} from "./musicbrainz"

/** Real Radiohead url-rels (subset), captured live from MusicBrainz. */
const RADIOHEAD_RELATIONS = [
  { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q42305" } },
  { type: "free streaming", url: { resource: "https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb" } },
  { type: "free streaming", url: { resource: "https://www.deezer.com/artist/323887691" } },
  { type: "free streaming", url: { resource: "https://www.deezer.com/artist/399" } },
  { type: "purchase for download", url: { resource: "https://music.apple.com/gb/artist/657515" } },
  { type: "streaming", url: { resource: "https://music.apple.com/gb/artist/657515" } },
  { type: "streaming", url: { resource: "https://tidal.com/artist/64518" } },
]

describe("parseSpotifyArtistId", () => {
  it("extracts a 22-char id", () => {
    expect(parseSpotifyArtistId("https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb")).toBe(
      "4Z8W4fKeB5YxbusRsdQVPb",
    )
  })
  it("handles a trailing query/path and si= params", () => {
    expect(parseSpotifyArtistId("https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb?si=abc")).toBe(
      "4Z8W4fKeB5YxbusRsdQVPb",
    )
  })
  it("returns null for non-spotify / album / malformed urls", () => {
    expect(parseSpotifyArtistId("https://open.spotify.com/album/4Z8W4fKeB5YxbusRsdQVPb")).toBeNull()
    expect(parseSpotifyArtistId("https://example.com/artist/abc")).toBeNull()
    expect(parseSpotifyArtistId("https://open.spotify.com/artist/tooshort")).toBeNull()
  })
})

describe("parseAppleArtistId", () => {
  it("extracts the numeric id with a locale segment", () => {
    expect(parseAppleArtistId("https://music.apple.com/gb/artist/657515")).toBe("657515")
  })
  it("extracts the id past a name slug", () => {
    expect(parseAppleArtistId("https://music.apple.com/us/artist/radiohead/657515")).toBe("657515")
  })
  it("handles the id-prefixed form", () => {
    expect(parseAppleArtistId("https://music.apple.com/us/artist/radiohead/id657515")).toBe("657515")
  })
  it("returns null for non-apple urls", () => {
    expect(parseAppleArtistId("https://example.com/artist/657515")).toBeNull()
  })
})

describe("parseDeezerArtistId", () => {
  it("extracts a numeric id", () => {
    expect(parseDeezerArtistId("https://www.deezer.com/artist/323887691")).toBe("323887691")
  })
  it("handles a locale segment", () => {
    expect(parseDeezerArtistId("https://www.deezer.com/en/artist/399")).toBe("399")
  })
  it("returns null for non-deezer urls", () => {
    expect(parseDeezerArtistId("https://example.com/artist/399")).toBeNull()
  })
})

describe("extractExternalIds", () => {
  it("extracts spotify/apple/deezer ids from a real url-rels response", () => {
    expect(extractExternalIds(RADIOHEAD_RELATIONS)).toEqual({
      spotifyId: "4Z8W4fKeB5YxbusRsdQVPb",
      appleId: "657515",
      deezerId: "323887691", // first deezer relation wins
    })
  })

  it("returns spotifyId null cleanly when no Spotify relation exists", () => {
    const noSpotify = RADIOHEAD_RELATIONS.filter((r) => !r.url.resource.includes("spotify"))
    const out = extractExternalIds(noSpotify)
    expect(out.spotifyId).toBeNull()
    expect(out.appleId).toBe("657515") // others still resolve
    expect(out.deezerId).toBe("323887691")
  })

  it("returns all-null for empty / missing / malformed relations", () => {
    expect(extractExternalIds([])).toEqual({ spotifyId: null, appleId: null, deezerId: null })
    expect(extractExternalIds(undefined)).toEqual({ spotifyId: null, appleId: null, deezerId: null })
    expect(extractExternalIds(null)).toEqual({ spotifyId: null, appleId: null, deezerId: null })
    expect(
      extractExternalIds([{ type: "x" }, { type: "y", url: {} }, { url: { resource: "" } }]),
    ).toEqual({ spotifyId: null, appleId: null, deezerId: null })
  })

  it("ignores non-music relations (wikidata, homepage)", () => {
    const out = extractExternalIds([
      { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q42305" } },
      { type: "official homepage", url: { resource: "https://www.radiohead.com" } },
    ])
    expect(out).toEqual({ spotifyId: null, appleId: null, deezerId: null })
  })
})

describe("createMbLimiter (1 req/s)", () => {
  function fakeTime() {
    let t = 0
    return {
      now: () => t,
      sleep: (ms: number) => {
        t += ms
        return Promise.resolve()
      },
      elapsed: () => t,
    }
  }

  it("enforces at least minIntervalMs between successive call starts", async () => {
    const ft = fakeTime()
    const limiter = createMbLimiter({ minIntervalMs: 1000, now: ft.now, sleep: ft.sleep })

    const starts: number[] = []
    await Promise.all(
      Array.from({ length: 3 }, () => limiter.run(async () => { starts.push(ft.now()) })),
    )
    // First runs immediately; each subsequent waits a full second.
    expect(starts).toEqual([0, 1000, 2000])
  })

  it("keeps the chain alive when a task throws, so later tasks still run on schedule", async () => {
    const ft = fakeTime()
    const limiter = createMbLimiter({ minIntervalMs: 1000, now: ft.now, sleep: ft.sleep })

    await expect(limiter.run(async () => { throw new Error("boom") })).rejects.toThrow("boom")
    const result = await limiter.run(async () => "ok")
    expect(result).toBe("ok")
    // The second call still waited out the interval from the first call's start.
    expect(ft.elapsed()).toBe(1000)
  })

  it("runs a single call with no initial delay", async () => {
    const ft = fakeTime()
    const limiter = createMbLimiter({ minIntervalMs: 1000, now: ft.now, sleep: ft.sleep })
    const out = await limiter.run(async () => 42)
    expect(out).toBe(42)
    expect(ft.elapsed()).toBe(0)
  })
})
