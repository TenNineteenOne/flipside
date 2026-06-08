import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ArtistEnrichment } from "./enrich-artist"

// Mock the enrichment module so lastfmResolve's getInfo call is deterministic
// and never hits the network.
const fetchArtistEnrichment = vi.fn<
  (name: string, apiKey: string) => Promise<ArtistEnrichment | null>
>()
vi.mock("./enrich-artist", async (importOriginal) => {
  // Keep the real module (mergeEnrichment etc. are imported transitively via
  // resolve-candidates) and only override fetchArtistEnrichment.
  const actual = await importOriginal<typeof import("./enrich-artist")>()
  return {
    ...actual,
    fetchArtistEnrichment: (name: string, apiKey: string) => fetchArtistEnrichment(name, apiKey),
  }
})

import { lastfmResolve } from "./engine"

describe("lastfmResolve (Spotify-free name resolver)", () => {
  const prevKey = process.env.LASTFM_API_KEY

  beforeEach(() => {
    fetchArtistEnrichment.mockReset()
    process.env.LASTFM_API_KEY = "test-key"
  })
  afterEach(() => {
    if (prevKey === undefined) delete process.env.LASTFM_API_KEY
    else process.env.LASTFM_API_KEY = prevKey
  })

  it("returns [] when enrichment is null (genuine artist-not-found)", async () => {
    fetchArtistEnrichment.mockResolvedValue(null)
    const out = await lastfmResolve("No Such Artist")
    expect(out).toEqual([])
  })

  it("returns a single enriched Artist with spotifyId=null, empty id, null imageUrl", async () => {
    fetchArtistEnrichment.mockResolvedValue({ genres: ["indie rock", "dream pop"], popularity: 55 })
    const out = await lastfmResolve("Beach House")
    expect(out).toHaveLength(1)
    const a = out[0]
    expect(a.name).toBe("Beach House")
    expect(a.id).toBe("")            // uuid minted downstream
    expect(a.spotifyId).toBeNull()   // #159 backfills later
    expect(a.imageUrl).toBeNull()    // Stage 3 fills real art
    expect(a.genres).toEqual(["indie rock", "dream pop"])
    expect(a.popularity).toBe(55)
  })

  it("returns [] when the Last.fm key is missing (no network call)", async () => {
    delete process.env.LASTFM_API_KEY
    const out = await lastfmResolve("Anything")
    expect(out).toEqual([])
    expect(fetchArtistEnrichment).not.toHaveBeenCalled()
  })
})
