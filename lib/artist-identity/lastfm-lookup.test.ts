import { describe, it, expect, vi } from "vitest"
import { buildEnrichArtist, lastfmResolve, mergeEnrichment } from "./lastfm-lookup"
import type { Artist } from "@/lib/music-provider/types"
import type { ArtistEnrichment, Lastfm } from "@/lib/lastfm"

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

/** Fake Last.fm adapter: only getInfo matters here. */
function fakeLastfm(info: ArtistEnrichment | null, hasKey = true) {
  const artistInfo = vi.fn(async () => info)
  const lf = { hasKey: () => hasKey, artistInfo } as unknown as Lastfm
  return { lf, artistInfo }
}

describe("lastfmResolve (Spotify-free name resolver)", () => {
  it("returns [] when getInfo is null (genuine artist-not-found)", async () => {
    expect(await lastfmResolve("No Such Artist", fakeLastfm(null).lf)).toEqual([])
  })

  it("returns a single enriched Artist with spotifyId=null, empty id, null imageUrl", async () => {
    const out = await lastfmResolve("Beach House", fakeLastfm({ genres: ["indie rock", "dream pop"], popularity: 55 }).lf)
    expect(out).toEqual([
      { id: "", spotifyId: null, name: "Beach House", genres: ["indie rock", "dream pop"], popularity: 55, imageUrl: null },
    ])
  })

  it("returns [] when the Last.fm key is missing (no lookup)", async () => {
    const { lf, artistInfo } = fakeLastfm({ genres: [], popularity: 1 }, false)
    expect(await lastfmResolve("Anything", lf)).toEqual([])
    expect(artistInfo).not.toHaveBeenCalled()
  })
})

describe("buildEnrichArtist", () => {
  it("is undefined without a key (callers feature-detect) and getInfo otherwise", async () => {
    expect(buildEnrichArtist(fakeLastfm(null, false).lf)).toBeUndefined()
    const { lf, artistInfo } = fakeLastfm({ genres: ["jazz"], popularity: 4 })
    expect(await buildEnrichArtist(lf)!("X")).toEqual({ genres: ["jazz"], popularity: 4 })
    expect(artistInfo).toHaveBeenCalledWith("X")
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
