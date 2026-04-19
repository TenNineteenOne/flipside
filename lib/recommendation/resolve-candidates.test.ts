import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveArtistsByName, type ResolveDeps } from "./resolve-candidates"
import type { Artist } from "@/lib/music-provider/types"
import type { RateLimited } from "@/lib/music-provider"

function artist(id: string, name: string, popularity = 50): Artist {
  return { id, name, genres: [], imageUrl: null, popularity }
}

const rl = (sec = 1): RateLimited => ({ rateLimited: true, retryAfterSec: sec })

function makeDeps(opts: {
  cache?: Map<string, Artist>
  search?: (name: string) => Promise<Artist[] | RateLimited>
  cacheWrites?: Map<string, Artist>
  maxAttemptsPerName?: number
  totalBackoffBudgetMs?: number
  maxRetryBackoffMs?: number
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
})
