import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveArtistsByName, type ResolveDeps } from "./resolve-candidates"
import type { Artist } from "@/lib/music-provider/types"

function artist(id: string, name: string, popularity = 50): Artist {
  return { id, name, genres: [], imageUrl: null, popularity }
}

function makeDeps(opts: {
  cache?: Map<string, Artist>
  search?: (name: string) => Promise<Artist[] | null>
  cacheWrites?: Map<string, Artist>
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
    backoffMs: 0,
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
    const search = vi.fn(async () => [] as Artist[])
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
    const search = vi.fn(async (name: string) => [artist(`id-${name}`, name)])
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
    const search = vi.fn(async (name: string) => [artist(`id-${name}`, name)])
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
    const search = async () => [
      artist("wrong", "Khruangbin Tribute"),
      artist("right", "Khruangbin"),
    ]
    const r = await resolveArtistsByName(["Khruangbin"], makeDeps({ search }))
    expect(r.resolved.get("Khruangbin")?.id).toBe("right")
  })

  it("counts empty search results as searchFail", async () => {
    const search = async () => [] as Artist[]
    const r = await resolveArtistsByName(["Nope"], makeDeps({ search }))
    expect(r.searchOk).toBe(0)
    expect(r.searchFail).toBe(1)
    expect(r.resolved.size).toBe(0)
  })

  it("retries once after a 429 then continues", async () => {
    let call = 0
    const search = vi.fn(async (name: string) => {
      call++
      if (call === 1) return null // first call: 429
      return [artist(`id-${name}`, name)]
    })
    const r = await resolveArtistsByName(["A", "B"], makeDeps({ search }))
    expect(r.rateLimited).toBe(true)
    // first name retried successfully, then second name searched normally
    expect(r.searchOk).toBe(2)
    expect(r.searchFail).toBe(0)
    expect(r.resolved.size).toBe(2)
  })

  it("aborts remaining searches after a second 429", async () => {
    const search = vi.fn(async () => null)
    const r = await resolveArtistsByName(["A", "B", "C"], makeDeps({ search }))
    expect(r.rateLimited).toBe(true)
    expect(r.resolved.size).toBe(0)
    // first call + retry = 2, then aborts
    expect(search).toHaveBeenCalledTimes(2)
  })

  it("still returns cache hits even when live search is rate-limited", async () => {
    const cache = new Map([["hit", artist("h1", "Hit")]])
    const search = vi.fn(async () => null)
    const r = await resolveArtistsByName(
      ["Hit", "Miss"],
      makeDeps({ cache, search })
    )
    expect(r.resolved.size).toBe(1)
    expect(r.resolved.get("Hit")?.id).toBe("h1")
    expect(r.cacheHits).toBe(1)
    expect(r.rateLimited).toBe(true)
  })
})
