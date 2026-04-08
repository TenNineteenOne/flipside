import { describe, it, expect, vi, beforeEach } from "vitest"
import { handleTracksRequest, type TracksDeps } from "./tracks-handler"
import type { Track } from "@/lib/music-provider/types"

const VALID_ID = "6eFbEFgrUMFP26JNjA02C8" // 22-char base62 (Khruangbin)

function makeTrack(id: string, name: string): Track {
  return {
    id,
    spotifyTrackId: id,
    name,
    previewUrl: null,
    durationMs: 200000,
    albumName: "Album",
    albumImageUrl: null,
    source: "spotify",
  }
}

function makeDeps(overrides: Partial<{
  market: string | (() => Promise<string>)
  marketThrows: Error
  tracks: Track[] | (() => Promise<Track[]>)
  tracksThrows: Error
}> = {}): TracksDeps {
  return {
    musicProvider: {
      getArtistTopTracks: async () => {
        if (overrides.tracksThrows) throw overrides.tracksThrows
        if (typeof overrides.tracks === "function") return overrides.tracks()
        return overrides.tracks ?? [makeTrack("t1", "Track One")]
      },
    },
    getMarket: async () => {
      if (overrides.marketThrows) throw overrides.marketThrows
      if (typeof overrides.market === "function") return overrides.market()
      return overrides.market ?? "US"
    },
  }
}

describe("handleTracksRequest", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  it("returns 401 when there is no spotifyId", async () => {
    const res = await handleTracksRequest(
      { spotifyId: null, accessToken: "tok", artistId: VALID_ID },
      makeDeps()
    )
    expect(res.status).toBe(401)
  })

  it("returns 401 when there is no access token", async () => {
    const res = await handleTracksRequest(
      { spotifyId: "user", accessToken: null, artistId: VALID_ID },
      makeDeps()
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when the artist ID is malformed", async () => {
    const res = await handleTracksRequest(
      { spotifyId: "user", accessToken: "tok", artistId: "not-a-real-id" },
      makeDeps()
    )
    expect(res.status).toBe(400)
  })

  it("returns 200 with tracks on success", async () => {
    const res = await handleTracksRequest(
      { spotifyId: "user", accessToken: "tok", artistId: VALID_ID },
      makeDeps({ tracks: [makeTrack("t1", "One"), makeTrack("t2", "Two")] })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tracks: Track[] }
    expect(body.tracks).toHaveLength(2)
    expect(body.tracks[0].id).toBe("t1")
  })

  it("returns 429 when getArtistTopTracks throws http_429", async () => {
    const res = await handleTracksRequest(
      { spotifyId: "user", accessToken: "tok", artistId: VALID_ID },
      makeDeps({ tracksThrows: new Error("http_429") })
    )
    expect(res.status).toBe(429)
  })

  it("returns 401 when getArtistTopTracks throws auth_expired", async () => {
    const res = await handleTracksRequest(
      { spotifyId: "user", accessToken: "tok", artistId: VALID_ID },
      makeDeps({ tracksThrows: new Error("auth_expired") })
    )
    expect(res.status).toBe(401)
  })

  it("returns 500 on unknown failure", async () => {
    const res = await handleTracksRequest(
      { spotifyId: "user", accessToken: "tok", artistId: VALID_ID },
      makeDeps({ tracksThrows: new Error("kaboom") })
    )
    expect(res.status).toBe(500)
  })

  it("falls back to US market when getMarket throws", async () => {
    let marketUsed = ""
    const deps: TracksDeps = {
      musicProvider: {
        getArtistTopTracks: async (_t, _id, _limit, market) => {
          marketUsed = market ?? ""
          return [makeTrack("t1", "One")]
        },
      },
      getMarket: async () => { throw new Error("market_oops") },
    }
    const res = await handleTracksRequest(
      { spotifyId: "user", accessToken: "tok", artistId: VALID_ID },
      deps
    )
    expect(res.status).toBe(200)
    expect(marketUsed).toBe("US")
  })

  it("passes the resolved market through to getArtistTopTracks", async () => {
    let marketUsed = ""
    const deps: TracksDeps = {
      musicProvider: {
        getArtistTopTracks: async (_t, _id, _limit, market) => {
          marketUsed = market ?? ""
          return [makeTrack("t1", "One")]
        },
      },
      getMarket: async () => "GB",
    }
    const res = await handleTracksRequest(
      { spotifyId: "user", accessToken: "tok", artistId: VALID_ID },
      deps
    )
    expect(res.status).toBe(200)
    expect(marketUsed).toBe("GB")
  })
})
