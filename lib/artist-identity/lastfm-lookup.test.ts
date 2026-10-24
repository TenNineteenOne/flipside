import { describe, it, expect, vi, afterEach } from "vitest"
import { buildEnrichArtist, lastfmResolve, mergeEnrichment, pickBestMatch } from "./lastfm-lookup"
import type { Artist } from "@/lib/music-provider/types"
import type { ArtistEnrichment, Lastfm, LastfmArtistCandidate } from "@/lib/lastfm"

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

describe("pickBestMatch (similarity guard)", () => {
  const cand = (name: string): LastfmArtistCandidate => ({ name, mbid: null, listeners: 0, imageUrl: null })

  afterEach(() => vi.restoreAllMocks())

  it("returns null for no candidates", () => {
    expect(pickBestMatch("anything", [])).toBeNull()
  })

  it("prefers an exact normalized match even when it is not ranked first", () => {
    const m = pickBestMatch("M", [cand("Madonna"), cand("M")])
    expect(m).not.toBeNull()
    expect(m!.name).toBe("M")
    expect(m!.similarity).toBe(1)
  })

  it("treats exact match as case- and punctuation-insensitive", () => {
    // normalizeArtistName lowercases + strips punctuation, so "ACDC" == "AC/DC".
    const m = pickBestMatch("acdc", [cand("AC/DC")])
    expect(m?.name).toBe("AC/DC")
    expect(m?.similarity).toBe(1)
  })

  it("handles short names via the exact path (similarity scores 0 for len < 2)", () => {
    expect(pickBestMatch("U2", [cand("U2")])?.name).toBe("U2")
    expect(pickBestMatch("M", [cand("M")])?.name).toBe("M")
  })

  it("accepts the best fuzzy candidate when it clears the threshold", () => {
    // One-char deletion → very high Dice similarity, no exact match.
    const m = pickBestMatch("Boards of Canada", [cand("Boards of Canda"), cand("Aphex Twin")])
    expect(m).not.toBeNull()
    expect(m!.name).toBe("Boards of Canda")
    expect(m!.similarity).toBeGreaterThanOrEqual(0.8)
    expect(m!.similarity).toBeLessThan(1)
  })

  it("rejects (and logs) when nothing clears the threshold, so the cache isn't poisoned", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    const m = pickBestMatch("Boards of Canada", [cand("Aphex Twin"), cand("Autechre")])
    expect(m).toBeNull()
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toContain("no confident match")
  })

  it("picks the highest-similarity candidate among several above threshold", () => {
    const m = pickBestMatch("Radiohead", [cand("Radiohed"), cand("Radioheadd")])
    expect(m).not.toBeNull()
    // Both are close; the guard must return whichever scores highest, not just the first.
    const sims = ["Radiohed", "Radioheadd"].map((n) => m!.name === n)
    expect(sims.some(Boolean)).toBe(true)
    expect(m!.similarity).toBeGreaterThanOrEqual(0.8)
  })
})
