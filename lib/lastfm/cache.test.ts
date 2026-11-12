import { describe, it, expect, vi } from "vitest"
import {
  cachedArtistEnrichment,
  cachedArtistSearch,
  prefetchCacheRows,
  type CacheStore,
} from "./cache"
import type { ArtistEnrichment } from "./types"

function memStore(): CacheStore & { rows: Map<string, { payload: unknown; fetched_at: string }> } {
  const rows = new Map<string, { payload: unknown; fetched_at: string }>()
  return {
    rows,
    async read(kind, key) { return rows.get(`${kind}:${key}`) ?? null },
    async write(kind, key, payload) { rows.set(`${kind}:${key}`, { payload, fetched_at: new Date().toISOString() }) },
  }
}

// ---------------------------------------------------------------------------
// cachedArtistEnrichment
// ---------------------------------------------------------------------------

describe("cachedArtistEnrichment", () => {
  it("MISS then HIT: fetchFn called once, second call served from store", async () => {
    const store = memStore()
    let calls = 0
    const fetchFn = async (name: string): Promise<ArtistEnrichment | null> => {
      void name
      calls++
      return { genres: ["jazz"], popularity: 50 }
    }

    // First call — cache miss, should call fetchFn
    const first = await cachedArtistEnrichment("jazz-artist-a1", fetchFn, store)
    expect(calls).toBe(1)
    expect(first).toEqual({ genres: ["jazz"], popularity: 50 })

    // Second call — cache hit, should NOT call fetchFn again
    const second = await cachedArtistEnrichment("jazz-artist-a1", fetchFn, store)
    expect(calls).toBe(1)
    expect(second).toEqual({ genres: ["jazz"], popularity: 50 })
  })

  it("NEGATIVE caching: not-found null is stored and served without re-fetching", async () => {
    const store = memStore()
    let calls = 0
    const fetchFn = async (name: string): Promise<ArtistEnrichment | null> => {
      void name
      calls++
      return null  // Genuine not-found
    }

    const first = await cachedArtistEnrichment("nonexistent-artist-b2", fetchFn, store)
    expect(calls).toBe(1)
    expect(first).toBeNull()
    // A null-payload row should have been written
    expect(store.rows.size).toBe(1)

    const second = await cachedArtistEnrichment("nonexistent-artist-b2", fetchFn, store)
    expect(calls).toBe(1)  // Still 1 — served from store
    expect(second).toBeNull()
  })

  it("TRANSIENT not cached: throw from fetchFn leaves store empty, next call re-fetches", async () => {
    const store = memStore()
    let calls = 0
    let shouldThrow = true
    const fetchFn = async (name: string): Promise<ArtistEnrichment | null> => {
      void name
      calls++
      if (shouldThrow) throw new Error("network error")
      return { genres: ["rock"], popularity: 60 }
    }

    // First call — transient failure, returns null, store NOT written
    const first = await cachedArtistEnrichment("transient-artist-c3", fetchFn, store)
    expect(calls).toBe(1)
    expect(first).toBeNull()
    expect(store.rows.size).toBe(0)  // No row written — transient must not be cached

    // Second call with fetchFn now succeeding — should re-fetch (not use non-existent cache)
    shouldThrow = false
    const second = await cachedArtistEnrichment("transient-artist-c3", fetchFn, store)
    expect(calls).toBe(2)  // Re-fetched
    expect(second).toEqual({ genres: ["rock"], popularity: 60 })
  })

  it("STALE negative re-fetch: expired negative row triggers a live fetch", async () => {
    const store = memStore()
    // Write a negative row with an old fetched_at (13h ago, past NEG_TTL_MS=12h)
    const oldTimestamp = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
    store.rows.set("getInfo:stale-negative-artist-d4", { payload: null, fetched_at: oldTimestamp })

    let calls = 0
    const fetchFn = async (name: string): Promise<ArtistEnrichment | null> => {
      void name
      calls++
      return { genres: ["blues"], popularity: 40 }
    }

    // The stale negative should be re-fetched
    const result = await cachedArtistEnrichment("stale-negative-artist-d4", fetchFn, store)
    expect(calls).toBe(1)
    expect(result).toEqual({ genres: ["blues"], popularity: 40 })
  })
})

// ---------------------------------------------------------------------------
// cachedArtistSearch
// ---------------------------------------------------------------------------

describe("cachedArtistSearch", () => {
  it("MISS then HIT: fetchFn called once, second call served from store", async () => {
    const store = memStore()
    let calls = 0
    const fetchFn = async (query: string, limit: number): Promise<string[]> => {
      void query; void limit
      calls++
      return ["Radiohead", "Radioactive"]
    }

    const first = await cachedArtistSearch("radio-query-e1", 5, fetchFn, store)
    expect(calls).toBe(1)
    expect(first).toEqual(["Radiohead", "Radioactive"])

    const second = await cachedArtistSearch("radio-query-e1", 5, fetchFn, store)
    expect(calls).toBe(1)  // Served from store
    expect(second).toEqual(["Radiohead", "Radioactive"])
  })

  it("NEGATIVE (empty) cached on short TTL: empty result stored, second call served from store", async () => {
    const store = memStore()
    let calls = 0
    const fetchFn = async (query: string, limit: number): Promise<string[]> => {
      void query; void limit
      calls++
      return []
    }

    const first = await cachedArtistSearch("empty-search-f2", 5, fetchFn, store)
    expect(calls).toBe(1)
    expect(first).toEqual([])
    expect(store.rows.size).toBe(1)  // Negative row written

    const second = await cachedArtistSearch("empty-search-f2", 5, fetchFn, store)
    expect(calls).toBe(1)  // Served from store (within NEG_TTL)
    expect(second).toEqual([])
  })

  it("TRANSIENT throw not cached: fetchFn throws → returns [], store empty, next call re-fetches", async () => {
    const store = memStore()
    let calls = 0
    let shouldThrow = true
    const fetchFn = async (query: string, limit: number): Promise<string[]> => {
      void query; void limit
      calls++
      if (shouldThrow) throw new Error("timeout")
      return ["Artist One"]
    }

    // First call — transient failure
    const first = await cachedArtistSearch("transient-search-g3", 5, fetchFn, store)
    expect(calls).toBe(1)
    expect(first).toEqual([])
    expect(store.rows.size).toBe(0)  // No row written

    // Second call — now succeeding, must re-fetch
    shouldThrow = false
    const second = await cachedArtistSearch("transient-search-g3", 5, fetchFn, store)
    expect(calls).toBe(2)
    expect(second).toEqual(["Artist One"])
  })
})

// ---------------------------------------------------------------------------
// Write-behind: the fetch path never waits on (or fails from) the cache write
// ---------------------------------------------------------------------------

describe("cache writes are write-behind", () => {
  it("returns the fresh payload while the write is still pending, and the write lands", async () => {
    let release!: () => void
    const writes: string[] = []
    const store: CacheStore = {
      async read() { return null },
      write: (kind, key) => new Promise<void>((r) => { release = () => { writes.push(`${kind}:${key}`); r() } }),
    }
    const out = await cachedArtistEnrichment("wb-artist-1", async () => ({ genres: ["dub"], popularity: 10 }), store)
    expect(out).toEqual({ genres: ["dub"], popularity: 10 })
    expect(writes).toEqual([]) // write issued but not awaited
    release()
    await Promise.resolve()
    expect(writes).toEqual(["getInfo:wb-artist-1"])
  })

  it("a failing write is logged, not thrown", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const store: CacheStore = {
      async read() { return null },
      async write() { throw new Error("db down") },
    }
    const out = await cachedArtistSearch("wb-query-1", 5, async () => ["x"], store)
    expect(out).toEqual(["x"])
    await new Promise((r) => setTimeout(r, 0))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[lfm-cache] write failed kind=search err=db down"))
    spy.mockRestore()
  })
})

describe("prefetchCacheRows", () => {
  it("one readMany serves each prefetched key's next read; later reads go to the store", async () => {
    const store = memStore()
    store.rows.set("getInfo:a", { payload: { genres: ["jazz"], popularity: 40 }, fetched_at: new Date().toISOString() })
    const readMany = vi.fn(async (kind: string, keys: string[]) =>
      new Map(keys.flatMap((k) => { const r = store.rows.get(`${kind}:${k}`); return r ? [[k, r] as const] : [] })),
    )
    const read = vi.spyOn(store, "read")
    const s: CacheStore = { ...store, read: store.read.bind(store), readMany }
    await prefetchCacheRows("getInfo", ["A", "B"], s)
    expect(readMany).toHaveBeenCalledExactlyOnceWith("getInfo", ["a", "b"])

    const fetchFn = vi.fn(async (): Promise<ArtistEnrichment | null> => ({ genres: ["rock"], popularity: 10 }))
    expect(await cachedArtistEnrichment("A", fetchFn, s)).toEqual({ genres: ["jazz"], popularity: 40 }) // prefetched hit
    expect(await cachedArtistEnrichment("B", fetchFn, s)).toEqual({ genres: ["rock"], popularity: 10 }) // prefetched miss → live
    expect(read).not.toHaveBeenCalled()
    await cachedArtistEnrichment("A", fetchFn, s) // consumed: a normal read now
    expect(read).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("a failed readMany leaves the per-key reads as before", async () => {
    const store = memStore()
    const s: CacheStore = { ...store, read: vi.fn(store.read), readMany: async () => { throw new Error("db down") } }
    await prefetchCacheRows("similar", ["X", "Y"], s)
    await cachedArtistEnrichment("X", async () => null, s)
    expect(s.read).toHaveBeenCalledTimes(1)
  })
})
