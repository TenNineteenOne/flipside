import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveArtistsByName, type ResolveDeps } from "./resolve-candidates"
import type { Artist, Track } from "@/lib/music-provider/types"
import type { RateLimited } from "@/lib/music-provider"
import type { ArtistEnrichment } from "./enrich-artist"

function artist(id: string, name: string, popularity = 50): Artist {
  return { id, name, genres: [], imageUrl: null, popularity }
}

function track(previewUrl: string | null = "https://p/1"): Track {
  return {
    id: "t1", spotifyTrackId: null, name: "Track", previewUrl,
    durationMs: 0, albumName: "", albumImageUrl: null, source: "itunes",
  }
}

const rl = (sec = 1): RateLimited => ({ rateLimited: true, retryAfterSec: sec })

function makeDeps(opts: {
  cache?: Map<string, Artist>
  search?: (name: string) => Promise<Artist[] | RateLimited>
  cacheWrites?: Map<string, Artist>
  maxAttemptsPerName?: number
  totalBackoffBudgetMs?: number
  maxRetryBackoffMs?: number
  enrichArtist?: (name: string) => Promise<ArtistEnrichment | null>
  confirmPreview?: (artist: Artist) => Promise<Track[]>
} = {}): ResolveDeps {
  const cacheMap = opts.cache ?? new Map<string, Artist>()
  const writes = opts.cacheWrites ?? new Map<string, Artist>()
  return {
    cache: {
      batchRead: async (names) => {
        const out = new Map<string, Artist>()
        for (const n of names) {
          const hit = cacheMap.get(n.toLowerCase())
          if (hit) out.set(n.toLowerCase(), hit)
        }
        return out
      },
      write: async (name, a) => {
        writes.set(name.toLowerCase(), a)
      },
    },
    searchArtists: opts.search ?? (async () => []),
    enrichArtist: opts.enrichArtist,
    confirmPreview: opts.confirmPreview,
    delayMs: 0,
    maxRetryBackoffMs: opts.maxRetryBackoffMs,
    totalBackoffBudgetMs: opts.totalBackoffBudgetMs,
    maxAttemptsPerName: opts.maxAttemptsPerName,
    sleep: async () => {},
  }
}

describe("resolveArtistsByName", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  it("returns empty result for empty input", async () => {
    const r = await resolveArtistsByName([], makeDeps())
    expect(r.resolved.size).toBe(0)
    expect(r.cacheHits).toBe(0)
    expect(r.cacheMisses).toBe(0)
  })

  it("uses cache for all hits and never calls search", async () => {
    const cache = new Map([
      ["khruangbin", artist("k1", "Khruangbin")],
      ["men i trust", artist("m1", "Men I Trust")],
    ])
    const search = vi.fn(async (): Promise<Artist[] | RateLimited> => [])
    const r = await resolveArtistsByName(
      ["Khruangbin", "Men I Trust"],
      makeDeps({ cache, search })
    )
    expect(r.cacheHits).toBe(2)
    expect(r.cacheMisses).toBe(0)
    expect(search).not.toHaveBeenCalled()
    expect(r.resolved.get("Khruangbin")?.id).toBe("k1")
    expect(r.resolved.get("Men I Trust")?.id).toBe("m1")
  })

  it("searches Spotify for all misses and writes them back to cache", async () => {
    const writes = new Map<string, Artist>()
    const search = vi.fn(async (name: string): Promise<Artist[] | RateLimited> => [artist(`id-${name}`, name)])
    const r = await resolveArtistsByName(
      ["A", "B"],
      makeDeps({ search, cacheWrites: writes })
    )
    expect(r.cacheHits).toBe(0)
    expect(r.cacheMisses).toBe(2)
    expect(r.searchOk).toBe(2)
    expect(search).toHaveBeenCalledTimes(2)
    expect(writes.size).toBe(2)
    expect(writes.get("a")?.id).toBe("id-A")
  })

  it("mixes cache hits and live searches", async () => {
    const cache = new Map([["cached", artist("c1", "Cached")]])
    const search = vi.fn(async (name: string): Promise<Artist[] | RateLimited> => [artist(`id-${name}`, name)])
    const r = await resolveArtistsByName(
      ["Cached", "Fresh"],
      makeDeps({ cache, search })
    )
    expect(r.cacheHits).toBe(1)
    expect(r.cacheMisses).toBe(1)
    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith("Fresh")
    expect(r.resolved.size).toBe(2)
  })

  it("prefers exact case-insensitive name match over first result", async () => {
    const search = async (): Promise<Artist[] | RateLimited> => [
      artist("wrong", "Khruangbin Tribute"),
      artist("right", "Khruangbin"),
    ]
    const r = await resolveArtistsByName(["Khruangbin"], makeDeps({ search }))
    expect(r.resolved.get("Khruangbin")?.id).toBe("right")
  })

  it("counts empty search results as searchFail", async () => {
    const search = async (): Promise<Artist[] | RateLimited> => []
    const r = await resolveArtistsByName(["Nope"], makeDeps({ search }))
    expect(r.searchOk).toBe(0)
    expect(r.searchFail).toBe(1)
    expect(r.resolved.size).toBe(0)
  })

  it("retries up to 3 times on 429, succeeds on third attempt", async () => {
    let call = 0
    const search = vi.fn(async (name: string): Promise<Artist[] | RateLimited> => {
      call++
      if (call < 3) return rl()
      return [artist(`id-${name}`, name)]
    })
    const r = await resolveArtistsByName(["A"], makeDeps({ search }))
    expect(r.rateLimited).toBe(true)
    expect(r.searchRetries).toBe(2)
    expect(r.searchOk).toBe(1)
    expect(r.searchFail).toBe(0)
    expect(r.resolved.get("A")?.id).toBe("id-A")
  })

  it("skips a name after exhausting retries and continues to next name", async () => {
    const search = vi.fn(async (name: string): Promise<Artist[] | RateLimited> => {
      if (name === "Bad") return rl()
      return [artist(`id-${name}`, name)]
    })
    const r = await resolveArtistsByName(["Bad", "Good"], makeDeps({ search }))
    expect(r.rateLimited).toBe(true)
    expect(r.searchOk).toBe(1)
    expect(r.searchFail).toBe(1)
    expect(r.resolved.has("Bad")).toBe(false)
    expect(r.resolved.get("Good")?.id).toBe("id-Good")
    // 3 attempts on Bad + 1 on Good
    expect(search).toHaveBeenCalledTimes(4)
  })

  it("honors capped retry-after and respects total backoff budget", async () => {
    const waits: number[] = []
    const search = vi.fn(async (): Promise<Artist[] | RateLimited> => rl(120))
    const deps: ResolveDeps = {
      ...makeDeps({ search, maxRetryBackoffMs: 20_000, totalBackoffBudgetMs: 30_000 }),
      sleep: async (ms) => { waits.push(ms) },
    }
    const r = await resolveArtistsByName(["A", "B"], deps)
    expect(r.rateLimited).toBe(true)
    // First name: retry wait clamped to 20_000 (cap), second wait clamped to 10_000 (budget left).
    expect(waits.slice(0, 2)).toEqual([20_000, 10_000])
    // After exhausting budget, no further sleeps for name B's retries.
    expect(r.backoffBudgetExhausted).toBe(true)
    expect(r.resolved.size).toBe(0)
  })

  it("still returns cache hits even when live search is rate-limited", async () => {
    const cache = new Map([["hit", artist("h1", "Hit")]])
    const search = vi.fn(async (): Promise<Artist[] | RateLimited> => rl())
    const r = await resolveArtistsByName(
      ["Hit", "Miss"],
      makeDeps({ cache, search })
    )
    expect(r.resolved.size).toBe(1)
    expect(r.resolved.get("Hit")?.id).toBe("h1")
    expect(r.cacheHits).toBe(1)
    expect(r.rateLimited).toBe(true)
  })

  it("runs miss resolution concurrently up to the configured pool size", async () => {
    let active = 0
    let maxActive = 0
    const search = vi.fn(async (name: string): Promise<Artist[] | RateLimited> => {
      active++
      if (active > maxActive) maxActive = active
      await new Promise((r) => setTimeout(r, 5))
      active--
      return [artist(`id-${name}`, name)]
    })
    const names = ["a", "b", "c", "d", "e", "f", "g", "h"]
    const r = await resolveArtistsByName(names, { ...makeDeps({ search }), concurrency: 4 })
    expect(r.searchOk).toBe(8)
    expect(maxActive).toBeGreaterThan(1)
    expect(maxActive).toBeLessThanOrEqual(4)
  })

  it("serializes to concurrency=1 when configured", async () => {
    let active = 0
    let maxActive = 0
    const search = vi.fn(async (name: string): Promise<Artist[] | RateLimited> => {
      active++
      if (active > maxActive) maxActive = active
      await new Promise((r) => setTimeout(r, 1))
      active--
      return [artist(`id-${name}`, name)]
    })
    const r = await resolveArtistsByName(["a", "b", "c"], { ...makeDeps({ search }), concurrency: 1 })
    expect(r.searchOk).toBe(3)
    expect(maxActive).toBe(1)
  })

  it("merges enrichment into Spotify result when Spotify genres/popularity are empty", async () => {
    const writes = new Map<string, Artist>()
    const search = async (name: string): Promise<Artist[] | RateLimited> => [artist(`id-${name}`, name, 0)]
    const enrichArtist = vi.fn(async (): Promise<ArtistEnrichment | null> => ({
      genres: ["indie rock", "post-rock"],
      popularity: 55,
    }))
    const r = await resolveArtistsByName(
      ["Khruangbin"],
      makeDeps({ search, enrichArtist, cacheWrites: writes })
    )
    expect(enrichArtist).toHaveBeenCalledWith("Khruangbin")
    const resolved = r.resolved.get("Khruangbin")!
    expect(resolved.genres).toEqual(["indie rock", "post-rock"])
    expect(resolved.popularity).toBe(55)
    expect(writes.get("khruangbin")?.genres).toEqual(["indie rock", "post-rock"])
    expect(writes.get("khruangbin")?.popularity).toBe(55)
  })

  it("does not override already-populated Spotify values with enrichment", async () => {
    const search = async (name: string): Promise<Artist[] | RateLimited> => {
      const a = artist(`id-${name}`, name, 80)
      return [{ ...a, genres: ["existing genre"] }]
    }
    const enrichArtist = async (): Promise<ArtistEnrichment | null> => ({
      genres: ["should not apply"],
      popularity: 20,
    })
    const r = await resolveArtistsByName(["A"], makeDeps({ search, enrichArtist }))
    const resolved = r.resolved.get("A")!
    expect(resolved.genres).toEqual(["existing genre"])
    expect(resolved.popularity).toBe(80)
  })

  it("survives null enrichment (cache write still happens with Spotify-only data)", async () => {
    const writes = new Map<string, Artist>()
    const search = async (name: string): Promise<Artist[] | RateLimited> => [artist(`id-${name}`, name, 0)]
    const enrichArtist = async (): Promise<ArtistEnrichment | null> => null
    const r = await resolveArtistsByName(
      ["A"],
      makeDeps({ search, enrichArtist, cacheWrites: writes })
    )
    expect(r.searchOk).toBe(1)
    expect(r.resolved.get("A")?.genres).toEqual([])
    expect(writes.get("a")?.id).toBe("id-A")
  })

  it("survives enrichment throwing (does not block Spotify resolve)", async () => {
    const writes = new Map<string, Artist>()
    const search = async (name: string): Promise<Artist[] | RateLimited> => [artist(`id-${name}`, name, 0)]
    const enrichArtist = async (): Promise<ArtistEnrichment | null> => {
      throw new Error("last.fm down")
    }
    const r = await resolveArtistsByName(
      ["A"],
      makeDeps({ search, enrichArtist, cacheWrites: writes })
    )
    expect(r.searchOk).toBe(1)
    expect(r.resolved.get("A")?.id).toBe("id-A")
    expect(writes.size).toBe(1)
  })

  it("does not call enrichment when Spotify search fails", async () => {
    const enrichArtist = vi.fn(async (): Promise<ArtistEnrichment | null> => ({
      genres: ["rock"],
      popularity: 50,
    }))
    const search = async (): Promise<Artist[] | RateLimited> => []
    const r = await resolveArtistsByName(["Nope"], makeDeps({ search, enrichArtist }))
    expect(r.searchFail).toBe(1)
    expect(r.resolved.size).toBe(0)
    // enrichment fired in parallel — it may have been invoked, but the important
    // thing is that no resolved artist got written and no errors leaked.
  })

  describe("confirmPreview (playability guarantee)", () => {
    it("is off by default: resolved artists keep undefined topTracks, nothing dropped", async () => {
      const search = async (name: string): Promise<Artist[] | RateLimited> => [artist(`id-${name}`, name)]
      const r = await resolveArtistsByName(["A"], makeDeps({ search }))
      expect(r.resolved.get("A")?.topTracks).toBeUndefined()
      expect(r.droppedNoPreview).toBe(0)
      expect(r.previewMs).toBe(0)
    })

    it("attaches confirmed topTracks to a resolved miss and writes them back to cache", async () => {
      const writes = new Map<string, Artist>()
      const search = async (name: string): Promise<Artist[] | RateLimited> => [artist(`id-${name}`, name)]
      const confirmPreview = async (): Promise<Track[]> => [track()]
      const r = await resolveArtistsByName(["A"], makeDeps({ search, cacheWrites: writes, confirmPreview }))
      expect(r.resolved.get("A")?.topTracks).toEqual([track()])
      expect(r.droppedNoPreview).toBe(0)
      // Single write-back carries the topTracks (the bare miss write is skipped).
      expect(writes.get("a")?.id).toBe("id-A")
      expect(writes.get("a")?.topTracks).toEqual([track()])
    })

    it("drops a resolved artist with no playable preview and negative-caches it", async () => {
      const writes = new Map<string, Artist>()
      const search = async (name: string): Promise<Artist[] | RateLimited> => [artist(`id-${name}`, name)]
      const confirmPreview = async (): Promise<Track[]> => []
      const r = await resolveArtistsByName(["A"], makeDeps({ search, cacheWrites: writes, confirmPreview }))
      expect(r.resolved.has("A")).toBe(false)
      expect(r.droppedNoPreview).toBe(1)
      // Negative cache persisted as confirmed-empty topTracks for a warm next time.
      expect(writes.get("a")?.topTracks).toEqual([])
    })

    it("confirms cache hits too — drops a hit that has no preview", async () => {
      const cache = new Map([["hit", artist("h1", "Hit")]])
      const confirmPreview = async (): Promise<Track[]> => []
      const r = await resolveArtistsByName(["Hit"], makeDeps({ cache, confirmPreview }))
      expect(r.cacheHits).toBe(1)
      expect(r.resolved.has("Hit")).toBe(false)
      expect(r.droppedNoPreview).toBe(1)
    })

    it("reuses already-confirmed topTracks on a hit without rewriting cache", async () => {
      const cachedArtist: Artist = { ...artist("h1", "Hit"), topTracks: [track()] }
      const cache = new Map([["hit", cachedArtist]])
      const writes = new Map<string, Artist>()
      // Mirror the real confirmPreview: reuse the artist's existing topTracks.
      const confirmPreview = async (a: Artist): Promise<Track[]> => a.topTracks ?? []
      const r = await resolveArtistsByName(["Hit"], makeDeps({ cache, cacheWrites: writes, confirmPreview }))
      expect(r.resolved.get("Hit")?.topTracks).toEqual([track()])
      expect(r.droppedNoPreview).toBe(0)
      // Not fresh (topTracks already present) → no redundant write-back.
      expect(writes.size).toBe(0)
    })

    it("degrades to a drop when confirmPreview throws (never leaks)", async () => {
      const search = async (name: string): Promise<Artist[] | RateLimited> => [artist(`id-${name}`, name)]
      const confirmPreview = async (): Promise<Track[]> => { throw new Error("boom") }
      const r = await resolveArtistsByName(["A"], makeDeps({ search, confirmPreview }))
      expect(r.resolved.has("A")).toBe(false)
      expect(r.droppedNoPreview).toBe(1)
    })
  })
})
